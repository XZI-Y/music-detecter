const fs=require('node:fs/promises'),path=require('node:path'),{createRequire}=require('node:module');
const builderRequire=createRequire(require.resolve('electron-builder'));
const libRequire=createRequire(builderRequire.resolve('app-builder-lib'));
const asar=libRequire('@electron/asar');
module.exports=async context=>{
 const resources=path.resolve(context.appOutDir,'resources'),scratch=path.join(resources,'.radar-split'),code=path.join(scratch,'code'),vendor=path.join(scratch,'vendor');
 const safe=target=>{const rel=path.relative(resources,path.resolve(target));if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Invalid package path');return target;};
 await fs.mkdir(code,{recursive:true});asar.extractAll(path.join(resources,'app.asar'),code);
 await fs.mkdir(vendor,{recursive:true});await fs.rename(path.join(code,'node_modules'),path.join(vendor,'node_modules'));
 const nativeRoot=path.join(vendor,'node_modules','onnxruntime-node','bin','napi-v3');
 for(const name of ['darwin','linux',path.join('win32','arm64')])await fs.rm(safe(path.join(nativeRoot,name)),{recursive:true,force:true});
 await asar.createPackageWithOptions(vendor,path.join(resources,'vendor.asar'),{unpack:'*.{node,dll}'});
 await asar.createPackage(code,path.join(resources,'app-code.asar'));
 await fs.rename(path.join(resources,'app-code.asar'),path.join(resources,'app.asar'));
 await fs.rm(safe(path.join(resources,'app.asar.unpacked')),{recursive:true,force:true});
 await fs.rm(safe(scratch),{recursive:true,force:true});
};
