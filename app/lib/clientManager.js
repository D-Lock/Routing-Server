'use strict';

var Promise = require('bluebird');

module.exports = function(_redis, _logger) {
  return {
    /** Stores the client information for all the sockets */
    redis: _redis,

    /** The logger being used in the application */
    logger: _logger,

    /** The name of the hash set to put the clients */
    setName: "clients",

    /**
     * Adds a user client to the client list
     * @param {Object} client - The new client client to associate with the user
     */
    addClient: function(client) {
      var self = this;

      return new Promise(function(resolve, reject){
        self.redis.hgetAsync(self.setName, client.client.id).then(function(result) {
          var parsed = JSON.parse(result);
          if(!result) {
            self.redis.hset(self.setName, client.client.id, JSON.stringify([client]));
            return resolve();
          }
          parsed.push(client);
          self.redis.hset(self.setName, client.client.id, JSON.stringify(parsed));
          resolve();
        }).catch(function(err) {
          self.logger.error(err);
          reject(err);
        });
      });
    },


    /**
     * Removes a users client by the given socket
     * @param {Object} client - The client to remove the socket from
     * @param {String} socket - The socket id of the client to remove
     */
    removeClientBySocket: function(client, socket) {
      var self = this;

      return new Promise(function(resolve, reject) {
        self.getClients(client.id).then(function(res) {
          var newClients = res.filter(function(entry) {
            return entry.socket !== socket;
          });
          self.redis.hset(self.setName, client.id, JSON.stringify(newClients));
        });
      });
    },

    /**
     * Determines whether the user has active clients
     * @param {String} user - The user id to check for client
     */
    hasClients: function(user) {
      var self = this;

      return new Promise(function(resolve, reject) {
        self.redis.hgetAsync(self.setName, user).then(function(result) {
          return !!result;
        });
      });
    },

    /**
     * Gets all client for a given user
     * @param {String} user - The user id associated with the client
     */
    getClients: function(user) {
      var self = this;

      return new Promise(function(resolve, reject) {
        self.redis.hgetAsync(self.setName, user).then(function(result) {
          if(!result) {
            return resolve([]);
          }
          resolve(JSON.parse(result));
        });
      });
    },

    /**
     * Checks to make sure all MAC addresses are connected
     * @param {String} user - The user id to check against
     * @param {string[]} referenceMACs - The MAC address list to compare to
     */
    checkMAC: function(user, referenceMACs) {
      var self = this;

      return new Promise(function(resolve, reject){ 
        self.getClients(user).then(function(clients) {
          var active = clients.map(function (entry) {
            return entry.client.mac
          });

          // Check if active and reference are the same
          for (let i = 0; i < referenceMACs.length; i++) {
            if (active.indexOf(referenceMACs[i]) === -1) {
              reject("MAC Addresses do not match");
            }
          }

          resolve();
        });
      });
    }
  }
};