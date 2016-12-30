module.exports = function(config) {
  const winston = require('winston');
  const path = require('path');
  const fs = require('fs');

  var logPath = path.join(__dirname, config.filePath)

  try {
    fs.mkdirSync(logPath);
  } catch(e) {
    if ( e.code != 'EEXIST' ) throw e;
  }
  
  return new winston.Logger({
    transports: [
      new (winston.transports.Console)(),
      new (require('winston-daily-rotate-file'))({ filename: path.join(logPath, config.fileName) })
    ]
  });
};