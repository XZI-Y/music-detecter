// Keep stable dependencies in their own archive so UI updates can reuse them.
const fs=require('node:fs'),path=require('node:path');
const vendor=path.resolve(__dirname,'..','..','vendor.asar');
if(fs.existsSync(vendor)){const directory=path.join(vendor,'node_modules');process.env.NODE_PATH=[directory,process.env.NODE_PATH].filter(Boolean).join(path.delimiter);require('node:module').Module._initPaths();}
