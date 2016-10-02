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

                if(user.id in requests){
                    requests[user.id].push(request);
                }
                else{
                    requests[user.id] =  [request];
                }

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
    fs.writeFile("downloads/" + hash, file.buffer, function (err) {
            if (err) {
                console.log('Could not write initial data file');
            }
            else {
                console.log('File saved');
                
                var user = users[socket.id];
                firebase.database().ref('files/' + user.id).child(hash).set({
                    path: file.name,
                    size: 0, 
                    type: "txt"});

                // Load the data and act accordingly
                firebase.database().ref('clients').child(users[socket.id].id).once('value').then(function (snapshot) {
                    var val = snapshot.val();
                    var refmacs = Object.keys(val.all).map(function (key) {
                        return val.all[key];
                    });
                    console.log("Refmacs: ", refmacs); // DEBUG
                    if (checkMAC(user.id, refmacs)) {
                        createParts(user, socket, file).then(function(parts) {
                            distributeParts(user, parts, hash);
                        }).catch(function(err) {
                            console.error(err);
                        });
                        //distribute(users[socket.id], socket, file, delivery);
                    }
                }).catch(function (err) {
                    console.log(err); // DEBUG
                });
            }
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
                console.log(file.params);
                var userRequests = requests[file.params.userId];
                userRequests.forEach(function(request){
                    if(request.hash !== hash) return;
                    ++request.current;
                    if(request.current === request.parts){
                        mergeParts(request, file.params.userId);
                    }
                });
            }
        });
    });
    
}

function createParts(user, socket, file) {
    return new Promise(function(resolve, reject) {
        var userConnects = connections[user.id];

        //Clear the folder
        fse.emptyDir('downloads/temp', function(err) {
            if(err) reject(err);
            var process = spawn('python', ["Tools/split_file.py", "downloads/" + file.name, userConnects.length, "-o",
            "downloads/temp/split"]);

            process.on('close', function (code) {
                var chunks = fs.readdirSync('downloads/temp');

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

function mergeParts(request, userId) {
    var userConnects = connections[user.id];

    //Clear the folder
    fse.emptyDir('downloads/temp', function(err) {
        if(err) reject(err);
        var process = spawn('python', ["Tools/merge_file.py", "downloads/" + request.hash + "/" + request.hash + "_1", 
            request.parts, "-o", "downloads/" + request.hash]);

        process.on('close', function (code) {
            
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

        console.log(path.join(__dirname, "/downloads/temp/", parts[i]));
        // Try to send
        delivery.send({
            name: hash + "_" + (i+1),
            path: path.join(__dirname, "/downloads/temp/", parts[i])
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
