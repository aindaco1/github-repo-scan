import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
const files=['README.md','AGENTS.md',...['ARCHITECTURE','CONFIGURATION','EMAIL','OPERATIONS','REPOSITORY_SELECTION','IMPLEMENTATION_PLAN','SECURITY','EXAMPLE_CODEX_HANDOFF'].map(n=>`docs/${n}.md`)];
for(const file of files){const text=await readFile(file,'utf8');if((text.match(/^```/gm)??[]).length%2)throw new Error(`Unclosed code fence: ${file}`);for(const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){const link=match[1];if(/^(https?:|#)/.test(link))continue;await access(path.resolve(path.dirname(file),link.split('#')[0]));}}
console.log('Documentation structure and local links valid.');
