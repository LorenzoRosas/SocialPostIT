const fs = require('fs');
const path = require('path');

const fileManager = {
    // Reads JSON data from a file
    readFile: function(filePath) {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    return reject(err);
                }
                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (parseError) {
                    reject(parseError);
                }
            });
        });
    },

    // Writes JSON data to a file
    writeFile: function(filePath, data) {
        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    },

    // Updates JSON data in a file
    updateFile: function(filePath, updates) {
        return this.readFile(filePath)
            .then(data => {
                const updatedData = { ...data, ...updates };
                return this.writeFile(filePath, updatedData);
            });
    },

    // Deletes a file
    deleteFile: function(filePath) {
        return new Promise((resolve, reject) => {
            fs.unlink(filePath, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
};

module.exports = fileManager;