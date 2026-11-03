from pathlib import Path
import json,re,hashlib
ROOT=Path(__file__).resolve().parents[1]
if any('local_sha256' in row for row in json.loads((ROOT/'third-party/manifest.json').read_text())):
    raise SystemExit('Adaptations already applied. Refusing to overwrite local changes.')
studio=ROOT/'packages/studio-ui/src'
for p in (studio/'components').rglob('*.jsx'):
    s=p.read_text().replace('../muapi.js','../platform-client.js')
    for tag,name in [('img','LocalImage'),('video','LocalVideo'),('audio','LocalAudio')]:
        if re.search(r'<'+tag+r'\b',s):
            rel='../../LocalMedia.jsx' if p.parent.name=='prompt' else '../LocalMedia.jsx'
            s=s.replace('"use client";','"use client";\nimport { '+name+' } from "'+rel+'";',1)
            if not s.startswith('"use client";'):
                s='import { '+name+' } from "'+rel+'";\n'+s
            s=re.sub(r'<'+tag+r'\b','<'+name,s).replace('</'+tag+'>','</'+name+'>')
    # Do not depend on upstream hosted demonstration images or tracking/logos.
    s=re.sub(r'https://d3adwkbyhxyrtq\.cloudfront\.net/[^\s"\']+', '/media-placeholder.svg', s)
    if p.name=='DrawModal.jsx':
        s='import { resolveMediaURL } from "../LocalMedia.jsx";\n'+s
        s=s.replace('img.src = bgImageUrl;', 'resolveMediaURL(bgImageUrl).then(url => { img.src = url; });')
    p.write_text(s)

field=ROOT/'packages/workflow-ui/src/vendor/RenderField.jsx'
s=field.read_text().replace('import axios from "axios";','').replace('import Image from "next/image";','import { LocalImage as Image } from "./LocalMedia.jsx";')
start=s.index('    setUploading(true);')
end=s.index('\n  const isInputModel',start)
s=s[:start]+'''    setUploading(true);
    Promise.resolve(data.onUpload(file)).then(url => {
      setFormValues(prev => ({...prev,[field]:fieldSchema.type === 'array' ? [...(prev[field] || []),url] : url}));
    }).catch(error => toast.error(error.message || '保存素材失败')).finally(() => {
      setUploading(false); setUploadProgress(0);
    });
  };
''' +s[end:]
s=s.replace('* required','* 必填')
field.write_text(s)
menu=ROOT/'packages/workflow-ui/src/vendor/NodeOptionsMenu.jsx'
s=menu.read_text().replace('from "./utility"','from "./download.js"').replace('<span>Duplicate</span>','<span>复制节点</span>').replace('<span>Download</span>','<span>下载</span>').replace('Delete Node {nodeId}','删除节点')
s=s.replace('className="p-1.5 hover:', 'aria-label="节点操作" className="p-1.5 hover:')
menu.write_text(s)

manifest=ROOT/'third-party/manifest.json'
rows=json.loads(manifest.read_text())
for row in rows:row['local_sha256']=hashlib.sha256((ROOT/row['target']).read_bytes()).hexdigest()
manifest.write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print('Adapted Studio network/media boundary and Vibe fields/menu.')
