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

    // Listen for incoming for files
    var delivery = dl.listen(socket);
    delivery.on('receive.success', function (file) {

        console.log("Received file"); // DEBUG

        var params = file.params;
        fs.writeFile("downloads/" + file.name, file.buffer, function (err) {
            if (err) {
                console.log('Could not write initial data file');
            }
            else {
                console.log('File saved');

                // Load the data and act accordingly
                firebase.database().ref('clients').child(users[socket.id].id).once('value').then(function (snapshot) {
                    var val = snapshot.val();
                    var refmacs = Object.keys(val.all).map(function (key) {
                        return val.all[key];
                    });
                    console.log("Refmacs: ", refmacs); // DEBUG
                    var user = users[socket.id];
                    if (checkMAC(user.id, refmacs)) {
                        createParts(user, socket, file).then(function(parts) {
                            distributeParts(user, parts, socket);
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

    });
});


function createParts(user, socket, file) {
    return new Promise(function(resolve, reject) {
        var userConnects = connections[user.id];

        //Clear the folder
        fse.emptyDir('downloads/temp', function(err) {
            if(err) reject(err);
            var process = spawn('python', ["Tools/split_file.py", "downloads/" + file.name, userConnects.length, "-o",
            "downloads/temp/split.txt"]);

            process.on('close', function (code) {
                var chunks = fs.readdirSync('downloads/temp');

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

// 'socket' is the connection that send the file to the server
function distributeParts(user, parts, socket) {
    // Generate the hash for the filename

    var delivery = dl.listen(socket);
    delivery.connect();
    
    // Send chunks
    for (i = 0; i < parts.length; i++) {
        console.log("Distributing")
        // DEBUG
        delivery.on('send.start', function (file) {
            console.log("Sending Started");
        });

        console.log(path.join(__dirname, "/downloads/temp/", parts[i]));
        // Try to send
        delivery.send({
            name: "test.txt",
            path: path.join(__dirname, "/downloads/temp/", parts[i])
        });

        // If success, store routing info in database
        delivery.on('send.success', function (uid) {
            console.log("Succesful send"); // DEBUG
            firebase.database().ref('routing/' + hash).child(userConnects[i].user.mac).set(chunks[i]);
        });
    }

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
