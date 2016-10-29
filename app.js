'use strict';

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

const fileManipulation = require('./lib/fileManipulation.js');

var io = require('socket.io').listen(config.socket.port);

var connections = {};
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
    })
    .catch(function(err) {
      logger.error("Could not get routing for file %s", hash);
      logger.error(err);
    });
  });

  // Handle incoming parts


  // Listen for incoming for files - Create file mode
  socket.on(messages.file.receive, function(filePackage) {
    receiveFile(filePackage, socket);
  });

  socket.on(messages.part.receive, function(filePackage) {
    receivePart(filePackage, socket);
  });

  // Listen for successful file sending
  socket.on(messages.file.success, function(fileInfo) {
    var user = users[socket.id];
    fileTransferSuccess(user, fileInfo);
  });

  socket.on(messages.part.success, function (fileInfo) {
    partTransferSuccess(fileInfo)
  });
});

/**
 * Handles when a file was successfully received by the client
 * @param {Object} user - The user associated with the transfer
 * @param {Object} fileInfo - The file information sent alongside the message
 */
function fileTransferSuccess(user, fileInfo) {
  //Remove the complete file from the server
  fse.remove("downloads/" + request.hash, function(err) {
    if(err) console.error("Error deleting hash folder");
  });

  //Remove the routing information from the database
  firebase.database().ref(tables.routing)
    .child(request.hash).remove();

  firebase.database().ref(tables.files)
    .child(user.id).child(request.hash).remove();
}

/**
 * Handles when a part was successfully received by the client
 * @param {Object} fileInfo - The file information sent alongside the message
 */
function partTransferSuccess(fileInfo) {
  //Log that the part was sent
  logger.debug("Successfully sent file part %s", fileInfo.partName);
}

/**
 * Handles the sockets receiving a full file upload
 * @param {Object} file - The full file
 * @param {Object} socket - The socket of the sender
 */
function receiveFile(file, socket) {
  var user = users[socket.id];
  logger.info('Received new file (%s) from %s (%s)', 
    file.name, user.id, user.mac);

  //Send back a successful response
  socket.emit(messages.file.success);

  var hash = (Math.random() + 1).toString(36).substr(2,32);
  mkdirp("downloads/full", function(){
    //Create a new Base64 buffer to write file from
    var buffer = new Buffer(file.data, 'base64');

    fs.writeFile("downloads/full/" + hash, buffer, function (err) {
      if (err) {
        logger.error('Could not write new upload %s', hash);
        logger.error(err);
        return;
      }

      logger.debug('Saved new file with hash %s', hash);
      
      firebase.database().ref(tables.files).child(user.id).child(hash)
      .set({
        path: file.name,
        size: file.size,
        type: file.extension
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

        createParts(user, socket, hash).then(function(parts) {
          distributeParts(user, parts, hash);
        }).catch(function(err) {
          logger.error('Unable to save parts for file %s', hash);
          logger.error(err);
        });
      }).catch(function (err) {
        logger.error('Unable to get clients for user %s', user.id);
        logger.error(err);
      });
    });
  });
}

/**
 * Handles the sockets receiving a new part
 * @param {Object} file - The file object that was sent
 * @param {Object} socket - The socket of the sender
 */
function receivePart(file, socket) {
  //Send back a successful response
  socket.emit(messages.part.success);

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

/**
 * Splits a file into multiple parts
 * @param {Object} user - The owner of the file
 * @param {Object} socket - The socket connected to the file
 * @param {string} hash - The hash of the file to be split
 */
function createParts(user, socket, hash) {
  return new Promise(function(resolve, reject) {
    var userConnects = connections[user.id];

    let inputFile = "downloads/full/" + hash;
    let outputFile = "downloads/" + hash + "/split";

    fs.mkdir("downloads/" + hash, function(err) {
      if(err) {
        logger.error("Could not make new parts directory %s", hash);
        logger.error(err);
        return reject("Could not make the new parts directory", hash);
      }

      fileManipulation.split(inputFile, userConnects.length, outputFile)
      .then(function() {
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
      })
      .catch(function(err){
        console.error("Couldn't split file %s", inputFile);
        console.error(err);
      });
    });
  });
}

/**
 * Sends a part of a file to a user
 * @param {Object} socket - The socket to send the file to
 * @param {string} partName - The name of the part file
 * @param {string} partPath - The path of the part on the local machine
 * @param {Object} params - Any extra paramaters to send with the part 
 */
function sendPart(socket, partName, partPath, params) {
  var buffer = fs.readFileSync(partPath);
  var data = buffer.toString('base64');

  var filePackage = {
    name: partName,
    data: data,
    params: params
  };
  socket.emit(messages.part.send, filePackage);
}

/**
 * Sends a combined file to a user
 * @param {Object} socket - The socket to send the file to
 * @param {string} fileName - The name of the file
 * @param {string} filePath - The path of the file on the local machine
 * @param {Object} params - Any extra paramaters to send with the file
 */
function sendFile(socket, fileName, filePath, params) {
  var buffer = fs.readFileSync(filePath);
  var data = buffer.toString('base64');

  var filePackage = {
    name: fileName,
    data: data,
    params: params
  };
  socket.emit(messages.file.send, filePackage);
}

/**
 * Merges file parts back together
 * @param {Object} request - The file download request
 * @param {Object} user - The user requesting the file merge
 */
function mergeParts(request, user) {
  var userConnects = connections[user.id];

  //Merge the downloaded parts back into one file
  let inputFile = "downloads/" + request.hash + "/" + request.hash + "_1";
  let outputFile = "downloads/" + request.hash + "/" + request.hash;
  fileManipulation.merge(inputFile, request.parts, outputFile)
  .then(function() {

    //Search for the origin connection
    var origin = request.origin;
    userConnects.forEach(function(connection) {
      if(connection.user.mac !== request.origin) return;

      //Get file information about the return file
      firebase.database().ref(tables.files)
      .child(user.id).child(request.hash)
      .once('value').then(function(snapshot) {
        var file = snapshot.val();

        logger.info("Sending file %s to %s (%s)", 
          file.path, user.id, user.mac);

        //Deliver the file to the user
        sendFile(connection.socket, file.path, outputFile, {
          hash: request.hash
        });
      });
    });
  })
  .catch(function(err) {
    logger.error("Couldn't merge file %s", request.hash);
    logger.error(err);
  });
}

/**
 * Distributes the file parts to the user clients
 * @param {Object} user - The user to send it to
 * @param {string[]} parts - The part names to send
 * @param {stirng} hash - The file hash of the parts
 */
function distributeParts(user, parts, hash) {
  var userConnections = connections[user.id];
  var routingTable = {};
  // Send chunks
  for (let i = 0; i < parts.length; i++) {
    var partName = hash + "_" + (i+1);

    logger.debug("Sending file part %s to %s (%s)", 
      partName, user.id, user.mac);

    // Try to send
    let partPath = path.join(__dirname, "/downloads/", hash, parts[i]);
    sendPart(userConnections[i].socket, partName, partPath);
    
    routingTable[userConnections[i].user.mac] = i+1;
  }

  firebase.database().ref(tables.routing).child(hash).set(routingTable);
}

/**
 * Checks to make sure all MAC addresses are connected
 * @param {string} id - The user's ID
 * @param {string[]} referenceMACs - The MAC address list to compare to
 */
function checkMAC(id, referenceMACs) {
  var active = connections[id].map(function (conn) {
    return conn.user.mac
  });

  // Check if active and reference are the same
  for (let i = 0; i < referenceMACs.length; i++) {
    if (active.indexOf(referenceMACs[i]) === -1) {
      return false;
    }
  }

  return true;
}