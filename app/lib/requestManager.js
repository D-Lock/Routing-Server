'use strict';

var Promise = require('bluebird');

module.exports = function(_redis, _logger) {
  return {
    /** Stores the client information for all the sockets */
    redis: _redis,

    /** The logger being used in the application */
    logger: _logger,

    /** The name of the hash set to put the requests */
    setName: "requests",

    /**
     * Adds a new request to the database
     * @param {String} hash - The file's hash
     * @param {Object} request - The request properties to add
     */
    addRequest: function(hash, request) {
      this.redis.hset(this.setName, hash, JSON.stringify(request));
    },

    /**
     * Gets a request by a given hash
     * @param {String} hash - The file's hash
     */
    getRequest: function(hash) {
      var self = this;

      return new Promise(function(resolve, reject) {
        self.redis.hgetAsync(self.setName, hash).then(function(result) {
          if(!result) {
            return reject("Could not find request with the given hash");
          }
          resolve(JSON.parse(result));
        });
      });
    }
  };
}