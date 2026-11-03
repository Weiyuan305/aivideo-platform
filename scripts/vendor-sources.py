"""Vendor reviewed source subsets; never downloads or executes upstream code."""
from pathlib import Path
import hashlib
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT.parent / 'research/github-api-platform-2026-10-12/sources'
entries = []

def copy(repo, sha, source, target, license_name='MIT'):
    src = SOURCES / repo / source
    dst = ROOT / target
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    entries.append({'repository': repo.replace('__', '/'), 'commit': sha,
                    'upstream_path': source, 'target': target, 'license': license_name,
                    'upstream_sha256': hashlib.sha256(src.read_bytes()).hexdigest(),
                    'changes': 'See third-party/notices.md; target may be adapted.'})

if __name__ == '__main__':
    if (ROOT/'third-party/manifest.json').exists():
        raise SystemExit('Source snapshot already exists. Refusing to overwrite adapted files.')
    repo = 'Anil-matcha__Open-Generative-AI'
    sha = '6b704b0806bf07b435586ff182fb54fffe64253f'
    srcroot = (SOURCES / repo / 'packages/studio/src').resolve()
    pending = [srcroot / 'components' / n for n in ['ImageStudio.jsx','VideoStudio.jsx','AudioStudio.jsx']]
    seen = set()
    while pending:
        p = pending.pop()
        if p in seen: continue
        seen.add(p)
        if p.suffix == '.json' or p.name in {'muapi.js','models.js','persistKey.js'}: continue
        for imp in re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]', p.read_text()):
            if not imp.startswith('.'): continue
            q = p.parent / imp
            found = next((x.resolve() for x in [q,Path(str(q)+'.js'),Path(str(q)+'.jsx'),Path(str(q)+'.json')] if x.is_file()),None)
            if found: pending.append(found)
    for p in sorted(seen):
        if p.name in {'muapi.js','models.js','persistKey.js'}: continue
        rel = p.relative_to(srcroot)
        copy(repo,sha,'packages/studio/src/'+str(rel),'packages/studio-ui/src/'+str(rel))
    copy(repo,sha,'LICENSE','third-party/licenses/Open-Generative-AI.txt')

    repo = 'SamurAIGPT__Vibe-Workflow'
    sha = '121bde4ef0499ea000be98bdeaf1b244b928a8f3'
    for n in ['RenderField.jsx','NodeOptionsMenu.jsx','AudioPlayer.jsx']:
        copy(repo,sha,'packages/workflow-builder/src/components/'+n,'packages/workflow-ui/src/vendor/'+n)
    copy(repo,sha,'LICENSE','third-party/licenses/Vibe-Workflow.txt')

    repo = 'nextjs__saas-starter'
    sha = '6e33e58b1e553a41fe22e6b941a7229a002de361'
    for n in ['button.tsx','input.tsx','label.tsx','card.tsx']:
        copy(repo,sha,'components/ui/'+n,'apps/web/components/ui/'+n)
    copy(repo,sha,'lib/utils.ts','apps/web/lib/utils.ts')
    copy(repo,sha,'app/(dashboard)/dashboard/layout.tsx','apps/web/components/workspace-shell.tsx')
    copy(repo,sha,'LICENSE','third-party/licenses/saas-starter.txt')
    (ROOT/'third-party/manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2))
    print('Vendored',len(entries),'files; run adaptations before build. Do not rerun over edits.')
