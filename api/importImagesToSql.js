require('dotenv').config();
const { BlobServiceClient } = require('@azure/storage-blob');
const sql = require('mssql');

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerName = 'blobproductimagecontainer';
const containerClient = blobServiceClient.getContainerClient(containerName);

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: true, // Required for Azure SQL
    trustServerCertificate: false // Change to true for local development/self-signed certs
  }
};

async function importImages() {
  try {
    await sql.connect(sqlConfig);
    
    for await (const blob of containerClient.listBlobsFlat()) {
      const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
      const downloadBlockBlobResponse = await blockBlobClient.download(0);
      const buffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);

      const request = new sql.Request();
      await request.input('ImageData', sql.VarBinary(sql.MAX), buffer);
      await request.query('INSERT INTO Products (ImageUrl) VALUES (@ImageUrl)');
    }
  } catch (err) {
    console.error('Error importing images:', err);
    throw err;
  } finally {
    await sql.close();
  }
}

async function streamToBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    readableStream.on('error', reject);
  });
}

// This is an example handler for Azure Functions
module.exports = async function (context, req) {
  try {
    await importImages();
    context.res = {
      body: "Images successfully imported to SQL database."
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: `An error occurred: ${error.message}`
    };
  }
};
