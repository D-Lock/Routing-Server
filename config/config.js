var configFile = require('config');
var firebase = require('firebase');

var config = {};

//Logging
config.logger = require('./logging.js')(configFile.get('logging'));

//Firebase
firebase.initializeApp(configFile.get('firebase'));
config.firebase = firebase;

module.exports = config;