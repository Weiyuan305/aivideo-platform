import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const files=[];
function scan(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(["node_modules",".next","migrations"].includes(item.name))continue;const file=path.join(dir,item.name);if(item.isDirectory())scan(file);else if(/\.[jt]sx?$/.test(file))files.push(file);}}
scan(path.join(root,"apps/web"));scan(path.join(root,"packages"));
const errors=[];
for(const file of files){
  const text=fs.readFileSync(file,"utf8"),rel=path.relative(root,file);
  const browser=rel.startsWith("packages/studio-ui/")||rel.startsWith("packages/workflow-ui/")||/^\s*["']use client["']/.test(text);
  if(browser&&/from\s+["'](?:@aivideo\/(?:db|providers|server)|.*\/auth\/server)/.test(text))errors.push(`${rel}: server module imported by browser`);
  if(browser&&/process\.env/.test(text))errors.push(`${rel}: environment accessed by browser`);
  if(browser&&/fetch\(\s*["'`]https?:\/\//.test(text))errors.push(`${rel}: direct external request`);
  if(/NEXT_PUBLIC_(?:FAL|REPLICATE|S3|TRIGGER|BETTER_AUTH).*KEY/.test(text))errors.push(`${rel}: public secret variable`);
  if(rel.includes("studio-ui")&&/cdn\.muapi\.ai|cloudfront\.net/.test(text))errors.push(`${rel}: upstream hosted asset dependency`);
  if(/FixtureProvider|from\s+["'][^"']*tests\/server/.test(text))errors.push(`${rel}: test provider imported by product`);
}
if(errors.length){console.error(errors.join("\n"));process.exit(1);}
console.log(`Verified ${files.length} source files: browser/server boundary and API-only routing.`);
