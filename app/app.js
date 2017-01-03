'use strict';

var fs = require('fs');
var mkdirp = require('mkdirp');
var fse = require('fs-extra');
var path = require('path');
var crypto = require('crypto');
var Promise = require('bluebird');

var config = require('./config/config.js');
var logger = config.logger;
var firebase = config.firebase;
var tables = config.firebaseTables;
var messages = config.socket.messages;

var io = require('socket.io').listen(config.socket.port);
var redis = require('redis');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

var redisClient = redis.createClient(config.redis.port, config.redis.host);
var pubClient = redis.createClient(config.redis.port, config.redis.host, {return_buffers: true, auth_pass: ''});
var subClient = redis.createClient(config.redis.port, config.redis.host, {return_buffers: true, auth_pass: ''});

var fileManipulation = require('./lib/fileManipulation.js');
var authentication = require('./lib/authentication.js');
var clients = require('./lib/clientManager.js')(redisClient, logger);
var requests = require('./lib/requestManager.js')(redisClient, logger);

var adapter = require('socket.io-redis');
io.adapter(adapter({ pubClient: pubClient, subClient: subClient }));

logger.info('Server has started listening on port %s', config.socket.port);
logger.info('Redis server connected on %s:%s', config.redis.host, config.redis.port);

io.of('/').adapter.on('error', throwToLog);

io.on('connection', function (socket) {
  logger.info('Client has initiated connection (%s)', socket.handshake.address);

  //If the user logs off again
  socket.on('disconnect', function() {
    disconnectSocket(socket);
  });


  // Process user info
  socket.on(messages.authentication.clientInfo, function (client) {
    // Store details for this connection
    authentication.addClientSocket(client, socket);

    //Join the socket room
    socket.join(client.id, function() {
      logger.info("Client %s has joined room %s", client.mac, client.id);

      var newClient = {
        client: client,
        socket: socket.id
      };
      logger.info('Client %s (%s) has identified themselves',
        client.id, client.mac);

      clients.addClient(newClient).then(function(){
        var user = client.id;
        checkAllOnline(user).then(function(allOnline) {
          if(allOnline) {
            logger.info('User %s has connected all devices', client.id);
            io.to(client.id).emit(messages.authentication.userConnected);
          }
        }).catch(throwToLog);
      });
    });
  });

  socket.on(messages.authentication.clientOut, function () {
    disconnectSocket(socket);
  });

  // Handle file requests
  socket.on(messages.file.request, function(hash) {
    var client = authentication.getClientBySocket(socket);
    logger.info('User %s has requested file %s', client.id, hash);

    firebase.database().ref(tables.routing).child(hash).once('value')
    .then(function (snapshot) {
      // Get list of mac addresses from database
      var val = snapshot.val();
      var macs = Object.keys(val);
      // Verify that we have a connection with all required macs
      clients.checkMAC(client.id, macs).then(function() {
        var request = {
          origin: socket.id,
          hash: hash,
          parts: macs.length,
          current: 0
        };

        requests.addRequest(hash, request);

        clients.getClients(client.id).then(function(userClients){
          userClients.forEach(function(entry){
            // This file has not been striped to the given computer
            if(macs.indexOf(entry.client.mac) === -1) {
              console.log("returned");
              return;
            }

            logger.info('Sent part request to user %s (%s)',
              entry.client.id, entry.client.mac);

            io.to(entry.socket).emit(messages.sent.requestPart, {
              fileName: hash + '_' + val[entry.client.mac],
              hash: hash,
              userId: entry.client.id
              });
          });
        });
      }).catch(function(ex) {
        return logger.error('Could not match MAC addresses for %s', client.id);
      })
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
    var client = authentication.getClientBySocket(socket);
    fileTransferSuccess(client.id, fileInfo);
  });

  socket.on(messages.part.success, function (fileInfo) {
    partTransferSuccess(fileInfo)
  });
});

/**
 * Logs a socket out, and notifies other connections
 * @param {Object} socket - The socket that is logging out
 */
function disconnectSocket(socket) {
  if(authentication.isAuthenticated(socket)) {
    var client = authentication.getClientBySocket(socket);
    logger.info('Client %s (%s) has disconnected',
      client.id, client.mac);

    clients.removeClientBySocket(client, socket.id);

    authentication.removeClientBySocket(socket);

    clients.hasClients(client.id).then(function(hasClients) {
      if(hasClients) {
        io.sockets.in(client.id).emit(messages.authentication.userDisconnect);
      }
    });
  }
}

/**
 * Determines whether all devices for a given user are online
 * @param {String} user - The user id to check for
 */
function checkAllOnline(user) {
  return new Promise(function(resolve, reject) {
    getOnlineMacAddresses(user).then(function(online){
      getAllMacAddresses(user).then(function(all) {
        //If they are of different lengths, immediately return false
        if(all.length !== online.length) {
          resolve(false);
        }

        //Remove each of the MAC addresses from online
        all.forEach(function(val) {
          var index = online.indexOf(val);
          if(index === -1) {
            resolve(false);
          }

          online.splice(index, 1);
        });

        //If online is now empty, they have the same values
        resolve(online.length === 0);
      }).catch(function(err) {
        logger.error(err);
        reject();
      });
    });
  });
}

/**
 * Gets all online mac addresses associated with a given user
 * @param {String} user - The user id to check for
 */
function getOnlineMacAddresses(user) {
  var addresses = [];
  return new Promise(function(resolve, reject) {
    clients.getClients(user).then(function(userClients) {
      userClients.forEach(function(entry) {
        addresses.push(entry.client.mac);
      });
      resolve(addresses);
    });
  });
}

/**
 * Gets all the mac addresses associated with a given user
 * @param {String} user - The user id to check for
 */
function getAllMacAddresses(user) {
  return new Promise(function(resolve, reject) {
    firebase.database().ref(tables.clients).child(user).child('all')
    .once('value').then(function(snapshot) {
      var clientsObj = snapshot.val();
      var clientMacs = Object.keys(clientsObj).map(function(key) {
        return clientsObj[key].address;
      });

      resolve(clientMacs);
    });
  });
}

/**
 * Handles when a file was successfully received by the client
 * @param {String} user - The user id associated with the transfer
 * @param {Object} fileInfo - The file information sent alongside the message
 */
function fileTransferSuccess(user, fileInfo) {
  //Remove the complete file from the server
  fse.remove("downloads/" + fileInfo.hash, function(err) {
    if(err) {
      logger.error("Error deleting hash folder");
    }
  });

  //Remove the routing information from the database
  firebase.database().ref(tables.routing)
    .child(fileInfo.hash).remove();

  firebase.database().ref(tables.files)
    .child(user).child(fileInfo.hash).remove();
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
  var client = authentication.getClientBySocket(socket);
  logger.info('Received new file (%s) from %s (%s)',
    file.name, client.id, client.mac);

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

      firebase.database().ref(tables.files).child(client.id).child(hash)
      .set({
        path: file.name,
        size: file.size,
        type: file.extension
      });

      // Load the data and act accordingly
      firebase.database().ref(tables.clients).child(client.id)
      .once('value').then(function (snapshot) {
        var val = snapshot.val();
        var refmacs = Object.keys(val.all).map(function (key) {
          return val.all[key].address;
        });

        clients.checkMAC(client.id, refmacs).then(function(){
          createParts(client.id, hash).then(function(parts) {
            distributeParts(client.id, parts, hash);
          }).catch(function(err) {
            logger.error('Unable to save parts for file %s', hash);
            logger.error(err);
          });
        })
        .catch(function(){
          logger.error('Could not match MAC addresses for %s',
            client.id);
          return;
        });
      }).catch(function (err) {
        logger.error('Unable to get clients for user %s', client.id);
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
    var buffer = new Buffer(file.data, 'base64');

    fs.writeFile("downloads/" + file.params.hash + "/" + file.name,
      buffer, function (err) {
      if (err) {
        logger.error('Unable to receive part %s', file.params.hash);
        logger.error(err);
        return;
      }

      logger.debug('Received part %s', file.name);
      var client = authentication.getClientBySocket(socket);
      requests.getRequest(file.params.hash).then(function(request) {
        request.current++;
        if(request.current === request.parts){
          mergeParts(request, client.id);
        }
        // Save the new request back to the database
        requests.addRequest(file.params.hash, request);
      });
    });
  });
}

/**
 * Splits a file into multiple parts
 * @param {String} user - The user id of the owner of the file
 * @param {string} hash - The hash of the file to be split
 */
function createParts(user, hash) {
  return new Promise(function(resolve, reject) {
    clients.getClients(user).then(function(userClients) {
      var inputFile = "downloads/full/" + hash;
      var outputFile = "downloads/" + hash + "/split";

      fs.mkdir("downloads/" + hash, function(err) {
        if(err) {
          logger.error("Could not make new parts directory %s", hash);
          logger.error(err);
          return reject("Could not make the new parts directory", hash);
        }

        fileManipulation.split(inputFile, userClients.length, outputFile)
        .then(function() {
          //Subtract 1 to remove uploaded file
          var chunks = fs.readdirSync('downloads/' + hash);

          // Check if MAC number matches chunks
          if (chunks.length != userClients.length) {
            logger.error("Number of chunks did not match number " +
              "of MAC addresses for %s", hash);
            return reject(messages.error.macNumber);
          }

          resolve(chunks);
        })
        .catch(function(err){
          logger.error("Couldn't split file %s", inputFile);
          logger.error(err);
        });
      });
    });
  });
}

/**
 * Sends a part of a file to a user
 * @param {String} socketId - The ID of the socket to send the file to
 * @param {string} partName - The name of the part file
 * @param {string} partPath - The path of the part on the local machine
 * @param {Object} params - Any extra paramaters to send with the part
 */
function sendPart(socketId, partName, partPath, params) {
  var buffer = fs.readFileSync(partPath);
  var data = buffer.toString('base64');

  var filePackage = {
    name: partName,
    data: data,
    params: params
  };
  io.sockets.in(socketId).emit(messages.part.send, filePackage);
}

/**
 * Sends a combined file to a user
 * @param {String} socketId - The ID of the socket to send the file to
 * @param {string} fileName - The name of the file
 * @param {string} filePath - The path of the file on the local machine
 * @param {Object} params - Any extra paramaters to send with the file
 */
function sendFile(socketId, fileName, filePath, params) {
  var buffer = fs.readFileSync(filePath);
  var data = buffer.toString('base64');

  var filePackage = {
    name: fileName,
    data: data,
    params: params
  };
  io.sockets.in(socketId).emit(messages.file.send, filePackage);
}

/**
 * Merges file parts back together
 * @param {Object} request - The file download request
 * @param {String} user - The user id requesting the file merge
 */
function mergeParts(request, user) {
  clients.getClients(user).then(function(userClients){
    //Merge the downloaded parts back into one file
    let inputFile = "downloads/" + request.hash + "/" + request.hash + "_1";
    let outputFile = "downloads/" + request.hash + "/" + request.hash;
    fileManipulation.merge(inputFile, request.parts, outputFile)
    .then(function() {
      //Get file information about the return file
      firebase.database().ref(tables.files)
      .child(user).child(request.hash)
      .once('value').then(function(snapshot) {
        var file = snapshot.val();

        logger.info("Sending file %s to %s (%s)",
          file.path, user);

        //Deliver the file to the user
        sendFile(request.origin, file.path, outputFile, {
          hash: request.hash
        });
      });
    })
    .catch(function(err) {
      logger.error("Couldn't merge file %s", request.hash);
      logger.error(err);
    });
  });
}

/**
 * Distributes the file parts to the user clients
 * @param {String} user - The user id to send it to
 * @param {string[]} parts - The part names to send
 * @param {stirng} hash - The file hash of the parts
 */
function distributeParts(user, parts, hash) {
  clients.getClients(user).then(function(userClients){
    var routingTable = {};
    // Send chunks
    for (let i = 0; i < parts.length; i++) {
      var partName = hash + "_" + (i+1);

      logger.debug("Sending file part %s to %s (%s)",
        partName, user.id, user.mac);

      // Try to send
      let partPath = path.join(__dirname, "/downloads/", hash, parts[i]);
      sendPart(userClients[i].socket, partName, partPath);

      routingTable[userClients[i].client.mac] = i+1;
    }

    firebase.database().ref(tables.routing).child(hash).set(routingTable);
  });
}

/**
 * Used for catching promise errors and printing them to the logger
 * @param {String} exception - The exception to print to the logger
 */
function throwToLog(exception) {
  logger.error(exception);
}