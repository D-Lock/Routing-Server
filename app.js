var dl = require('delivery');
var fs = require('fs');
var mkdirp = require('mkdirp');
var fse = require('fs-extra');
var path = require('path');
var crypto = require('crypto');

const config = require('./config/config.js');
const logger = config.logger;
const firebase = config.firebase;
const tables = config.firebaseTables;
const messages = config.socket.messages;

var io = require('socket.io').listen(config.socket.port);
var spawn = require('child_process').spawn;

var connections = {}; // id :
var users = {};
var requests = {};

io.on('connection', function (socket) {
  logger.info('User has initiated connection %s', socket.handshake.address);

  // Process user info
  socket.on(messages.received.userInfo, function (newUser) {
    // Store details for this connection
    users[socket.id] = newUser;

    var newConn = {
      user: newUser,
      socket: socket
    };
    logger.info('User %s (%s) has identified themselves', 
      newUser.id, newUser.mac);

    if (newUser.id in connections) {
      connections[newUser.id].push(newConn);
    }
    else {
      connections[newUser.id] = [newConn];
    }
  });

  // TODO handle disconnect - remove MAC from connections

  // Handle file requests
  socket.on(messages.received.fileRequest, function(hash) {
    var user = users[socket.id];
    logger.info('User %s has requested file %s', user.id, hash);
    
    firebase.database().ref(tables.routing).child(hash).once('value')
    .then(function (snapshot) {
      // Get list of mac addresses from database
      var val = snapshot.val();
      var macs = Object.keys(val);
      // Verify that we have a connection with all required macs
      var userConnects = connections[user.id];
      if(checkMAC(user.id, macs)){
        var request = {
          origin: user.mac,
          hash: hash,
          parts: macs.length,
          current: 0
        };

        requests[hash] =  request;

        userConnects.forEach(function(connection){
          logger.debug('Sent part %s to user %s (%s)', 
            val[connection.user.mac], connection.user.id, 
            connection.user.mac);

          connection.socket.emit(messages.sent.requestPart, {
            fileName: hash + '_' + val[connection.user.mac], 
            hash: hash,
            userId: user.id,
           });
        });
      } else {
        logger.error('Could not match MAC addresses for %s', user.id);
      }
    });
  });

  // Handle incomping parts


  // Listen for incoming for files - Create file mode
  var delivery = dl.listen(socket);
  delivery.on(messages.received.receiveSuccess, function (file) {
    if(file.params.mode === 'upload'){
      receiveFile(file, socket);
    }
    else if(file.params.mode === 'part'){
      receivePart(file, socket);
    }
  });
});

function receiveFile(file, socket) {
  var user = users[socket.id];
  logger.info('Received new file (%s) from %s (%s)', 
    file.name, user.id, user.mac);

  var hash = (Math.random() + 1).toString(36).substr(2,32);
  mkdirp("downloads/full", function(){
    fs.writeFile("downloads/full/" + hash, file.buffer, function (err) {
      if (err) {
        logger.error('Could not write new upload %s', hash);
        logger.error(err);
        return;
      }

      logger.debug('Saved new file with hash %s', hash);
      
      //TODO: Get file size and type
      firebase.database().ref(tables.files).child(user.id).child(hash)
      .set({
        path: file.name,
        size: 0, 
        type: "txt"
      });

      // Load the data and act accordingly
      firebase.database().ref(tables.clients).child(user.id)
      .once('value').then(function (snapshot) {
        var val = snapshot.val();
        var refmacs = Object.keys(val.all).map(function (key) {
          return val.all[key];
        });
        
        if (!checkMAC(user.id, refmacs)) {
          logger.error('Could not match MAC addresses for %s', 
            user.id);
          return;
        }

        createParts(user, socket, file, hash).then(function(parts) {
          distributeParts(user, parts, hash);
        }).catch(function(err) {
          logger.error('Unable to save parts for file %s', hash);
          logger.error(err);
        });
      }).catch(function (err) {
        logger.error('Unable to get clients for user %s', user.id);
      });
    });
  });
}

function receivePart(file, socket) {
  fs.mkdir("downloads/" + file.params.hash, function(){
    fs.writeFile("downloads/" + file.params.hash + "/" + file.name, 
      file.buffer, function (err) {
      if (err) {
        logger.error('Unable to receive part %s', file.params.hash);
        logger.error(err);
        return;
      }

      logger.debug('Received part %s', file.name);
      var user = users[socket.id];
      var request = requests[file.params.hash];

      request.current++;
      if(request.current === request.parts){
        mergeParts(request, user);
      }
    });
  });
}

function createParts(user, socket, file, hash) {
  return new Promise(function(resolve, reject) {
    var userConnects = connections[user.id];

    fs.mkdir("downloads/" + hash, function(err) {
      if(err) {
        logger.error("Could not make new parts directory %s", hash);
        logger.error(err);
        return reject("Could not make the new parts directory", hash);
      }

      var process = spawn('python', ["Tools/split_file.py", 
        "downloads/full/" + hash, userConnects.length, "-o",
        "downloads/" + hash + "/split"]);

        process.on('close', function (code) {
          //Subtract 1 to remove uploaded file
          var chunks = fs.readdirSync('downloads/' + hash);

          // Check if MAC number matches chunks
          if (chunks.length != userConnects.length) {
            logger.error("Number of chunks did not match number" + 
              "of MAC addresses for %s", hash);
            socket.emit(messages.error.macNumber, 
              {errorMessage: "Number of chunks did not match" + 
              "number of MAC addresses"});
            return reject(messages.error.macNumber);
          }

          resolve(chunks);
        });
    });
  });
}

function mergeParts(request, user) {
  var userConnects = connections[user.id];

  var process = spawn('python', ["Tools/merge_file.py", "downloads/" + 
    request.hash + "/" + request.hash + "_1", 
    request.parts, "-o", "downloads/" + request.hash + "/" + request.hash]);

  process.on('close', function (code) {
    var origin = request.origin;
    userConnects.forEach(function(connection) {
      if(connection.user.mac !== request.origin) return;

      var delivery = dl.listen(connection.socket);
      delivery.connect();

      firebase.database().ref(tables.files)
      .child(user.id).child(request.hash)
      .once('value').then(function(snapshot) {
        var file = snapshot.val();

        logger.info("Sending file %s to %s (%s)", 
          file.path, user.id, user.mac);
        delivery.send({
          name: file.path,
          path: "downloads/" + request.hash + "/" + request.hash,
          params: {
            mode: 'download'
          }
        });
      });

      delivery.on(messages.received.sendSuccess, function() {
        fse.remove("downloads/" + request.hash, function(err) {
          if(err) console.error("Error deleting hash folder");
        });

        firebase.database().ref(tables.routing)
        .child(request.hash).remove();
        firebase.database().ref(tables.files)
        .child(user.id).child(request.hash).remove();
      });
    });
  });
}

function distributeParts(user, parts, hash) {
  var userConnections = connections[user.id];
  var routingTable = {};
  // Send chunks
  for (i = 0; i < parts.length; i++) {
    var delivery = dl.listen(userConnections[i].socket);
    delivery.connect();
    var partName = hash + "_" + (i+1);

    logger.debug("Sending file part %s to %s (%s)", 
      partName, user.id, user.mac);

    // Try to send
    delivery.send({
      name: partName,
      path: path.join(__dirname, "/downloads/", hash, parts[i]),
      params: {
        mode: "part"
      }
    });
    
    routingTable[userConnections[i].user.mac] = i+1;
    // If success, store routing info in database
    delivery.on(messages.received.sendSuccess, function (uid) {
      logger.debug("Successfully sent file part %s", partName);
    });
  }

  firebase.database().ref(tables.routing).child(hash).set(routingTable);
}

function checkMAC(id, referenceMACs) {
  var active = connections[id].map(function (conn) {
    return conn.user.mac
  });

  // Check if active and reference are the same
  for (i = 0; i < referenceMACs.length; i++) {
    if (active.indexOf(referenceMACs[i]) === -1) {
      return false;
    }
  }

  return true;
}