var io = require('socket.io').listen(1337);
var dl = require('delivery');
var fs = require('fs');
var fse = require('fs-extra');
var path = require('path');
var firebase = require('firebase');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

// Authenticate with firebase
var config = {
    apiKey: 'AIzaSyD--ACvhpg6AtGFXhdKwMgn8Lv8Q2oMTT4',
    authDomain: 'd-lock.firebaseapp.com',
    databaseURL: 'https://d-lock.firebaseio.com'
};
firebase.initializeApp(config);

var connections = {}; // id :
var users = {};
var requests = {};

io.on('connection', function (socket) {
    console.log("User has connected");

    // Process user info
    socket.on('user.info', function (newUser) {
        // Store details for this connection
        users[socket.id] = newUser;


        var newConn = {
            user: newUser,
            socket: socket
        };
        console.log(newConn.user);

        if (newUser.id in connections) {
            connections[newUser.id].push(newConn);
        }
        else {
            connections[newUser.id] = [newConn];
        }
    });

    // TODO handle disconnect - remove MAC from connections

    // Handle file requests
    socket.on('request.file', function(hash) {
        console.log(hash);
        firebase.database().ref('routing').child(hash).once('value').then(function (snapshot) {
            // Get list of mac addresses from database
            var val = snapshot.val();
            var macs = Object.keys(val);
            // Verify that we have a connection with all required macs
            var user = users[socket.id];
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
                    connection.socket.emit('request.part', {
                        fileName: hash + '_' + val[connection.user.mac], 
                        hash: hash,
                        userId: user.id,
                     });
                });
            }
        });
    });

    // Handle incomping parts


    // Listen for incoming for files - Create file mode
    var delivery = dl.listen(socket);
    delivery.on('receive.success', function (file) {
        console.log("Received file"); // DEBUG

        console.log(file.params.mode); // DEBUG

        if(file.params.mode === 'upload'){
            receiveFile(file, socket);
        }
        else if(file.params.mode === 'part'){
            receivePart(file, socket);
        }
    });
});

function receiveFile(file, socket) {
    var hash = (Math.random() + 1).toString(36).substr(2,32);
    fs.mkdir("downloads/full", function(){
        fs.writeFile("downloads/full/" + hash, file.buffer, function (err) {
            if (err) {
                console.log('Could not write initial data file');
            }
            else {
                console.log('File saved');
                
                var user = users[socket.id];
                firebase.database().ref('files/' + user.id).child(hash).set({
                    path: file.name,
                    size: 0, 
                    type: "txt"
                });

                // Load the data and act accordingly
                firebase.database().ref('clients').child(users[socket.id].id).once('value').then(function (snapshot) {
                    var val = snapshot.val();
                    var refmacs = Object.keys(val.all).map(function (key) {
                        return val.all[key];
                    });
                    console.log("Refmacs: ", refmacs); // DEBUG
                    if (checkMAC(user.id, refmacs)) {
                        createParts(user, socket, file, hash).then(function(parts) {
                            distributeParts(user, parts, hash);
                        }).catch(function(err) {
                            console.error(err);
                        });
                    }
                }).catch(function (err) {
                    console.log(err); // DEBUG
                });
            }
        });
    });
}

function receivePart(file, socket) {
    fs.mkdir("downloads/" + file.params.hash, function(){
        fs.writeFile("downloads/" + file.params.hash + "/" + file.name, file.buffer, function (err) {
            if (err) {
                console.log('Could not write initial data file');
            }
            else {
                console.log('File saved');
                var user = users[socket.id];
                var request = requests[file.params.hash];

                ++request.current;
                if(request.current === request.parts){
                    mergeParts(request, user);
                }
            }
        });
    });
}

function createParts(user, socket, file, hash) {
    return new Promise(function(resolve, reject) {
        var userConnects = connections[user.id];

        fs.mkdir("downloads/" + hash, function(err) {
            if(err) return reject("Could not make the new parts directory", hash);

            var process = spawn('python', ["Tools/split_file.py", "downloads/full/" + hash, userConnects.length, "-o",
                "downloads/" + hash + "/split"]);

                process.on('close', function (code) {
                    //Subtract 1 to remove uploaded file
                    var chunks = fs.readdirSync('downloads/' + hash);

                    // DEBUG
                    console.log(chunks.length, userConnects.length);

                    // Check if MAC number matches chunks
                    if (chunks.length != userConnects.length) {
                        socket.emit('error.mac.num', {errorMessage: "Number of chunks did not match number of MAC addresses"})
                        return reject('error.mac.num')
                    }

                    resolve(chunks);
                });
        });
    });
}

function mergeParts(request, user) {
    var userConnects = connections[user.id];

    var process = spawn('python', ["Tools/merge_file.py", "downloads/" + request.hash + "/" + request.hash + "_1", 
        request.parts, "-o", "downloads/" + request.hash + "/" + request.hash]);

    process.on('close', function (code) {
        var origin = request.origin;
        userConnects.forEach(function(connection) {
            if(connection.user.mac !== request.origin) return;

            var delivery = dl.listen(connection.socket);
            delivery.connect();

            firebase.database().ref('files/' + user.id).child(request.hash).once('value').then(function(snapshot) {
                var file = snapshot.val();
                delivery.send({
                    name: file.path,
                    path: "downloads/" + request.hash + "/" + request.hash,
                    params: {
                        mode: 'download'
                    }
                });
            });

            delivery.on('send.success', function() {
                fse.remove("downloads/" + request.hash, function(err) {
                    if(err) console.error("Error deleting hash folder");
                });

                firebase.database().ref('routing').child(request.hash).remove();
                firebase.database().ref('files').child(user.id).child(request.hash).remove();
            });
        });
    });
}

function distributeParts(user, parts, hash) {
    // Generate the hash for the filename

    var userConnections = connections[user.id];
    var routingTable = {};
    // Send chunks
    for (i = 0; i < parts.length; i++) {
        var delivery = dl.listen(userConnections[i].socket);
        delivery.connect();
        console.log("Distributing")
        // DEBUG
        delivery.on('send.start', function (file) {
            console.log("Sending Started");
        });

        // Try to send
        delivery.send({
            name: hash + "_" + (i+1),
            path: path.join(__dirname, "/downloads/", hash, parts[i]),
            params: {
                mode: "part"
            }
        });
        
        routingTable[userConnections[i].user.mac] = i+1;
        // If success, store routing info in database
        delivery.on('send.success', function (uid) {
            console.log("Successful send"); // DEBUG
        });
    }

    firebase.database().ref('routing/' + hash).set(routingTable);
    // TODO check if the hash for the file name has the same amount of children as mac addresses
}

function checkMAC(id, referenceMACs) {

    var active = connections[id].map(function (conn) {
        return conn.user.mac
    });

    // Check if active and reference are the same
    same = true;
    for (i = 0; i < referenceMACs.length; i++) {
        if (active.indexOf(referenceMACs[i]) === -1) {
            same = false
        }
    }

    return same;
}
