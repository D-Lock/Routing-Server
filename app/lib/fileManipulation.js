'use strict';

const spawn = require('child_process').spawn;

module.exports = {
  /**
   * Handles the splitting of the files into parts
   * @param {string} inputFile - The path of the input file to be split
   * @param {number} parts - The number of parts to split it into
   * @param {string} outputFile - The output file path of the first split
   */
  split: function(inputFile, parts, outputFile) {
    return new Promise(function(resolve, reject) {
      var process = spawn('python3', ["Tools/split_file.py", 
        inputFile, parts, "-o",
        outputFile]);
        
      process.on('close', function (code) {
        return resolve();
      });

      process.on('error', function(err) {
        return reject(err);
      }); 
    });
  },

  /**
   * Merges the parts back into a file
   * @param {string} inputPath - The path of the split files
   * @param {number} parts - The number of split files to merge
   * @param {string} outputFile - The path of the output file 
   */
  merge: function(inputPath, parts, outputFile) {
    return new Promise(function(resolve, reject) {
      //Create the spawn process
      var process = spawn('python3', ["Tools/merge_file.py", inputPath, 
        parts, "-o", outputFile]);

      process.on('close', function (code) {
        return resolve();
      });

      process.on('error', function(err) {
        return reject(err);
      });
    });
  }
};