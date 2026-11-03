import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root=path.resolve(import.meta.dirname,"..");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"third-party/manifest.json"),"utf8"));
const errors=[];
for(const source of manifest){
  const file=path.join(root,source.target);
  if(!fs.existsSync(file)){errors.push(`Missing ${source.target}`);continue;}
  const hash=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if(hash!==source.local_sha256)errors.push(`Modified without updating manifest: ${source.target}`);
  if(!/^[a-f0-9]{40}$/.test(source.commit)||!source.upstream_sha256||source.license!=="MIT")errors.push(`Invalid provenance: ${source.target}`);
}
if(errors.length){console.error(errors.join("\n"));process.exit(1);}
console.log(`Verified ${manifest.length} fixed-source snapshots and local hashes.`);
