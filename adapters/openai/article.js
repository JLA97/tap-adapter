export default {
  description: 'Extract article content from an OpenAI blog post URL.',
  args: [
    {
      name: 'url',
      default: '',
      description: 'Full URL of an OpenAI blog article, e.g. https://openai.com/index/mrc-supercomputer-networking/',
    },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: 'Article title.',
      },
      date: {
        type: 'string',
        description: 'Publication date.',
        format: 'date',
      },
      category: {
        type: 'string',
        description: 'Article category (Engineering, Research, etc.).',
      },
      url: {
        type: 'string',
        description: 'Article canonical URL.',
        format: 'url',
      },
      content: {
        type: 'string',
        description: 'Full article body text in markdown format.',
      },
    },
  },
  columns: ['title', 'date', 'category'],
  pipeline: [
    {
      "navigate": "${{ args.url }}"
    },
    {
      "evaluate": `(() => {
  const main = document.querySelector('main');
  if (!main) throw new Error('OpenAI article: main content missing: '+location.href);
  const title = main.querySelector('h1')?.textContent.trim() || '';
  const date = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || [...main.querySelectorAll('p.text-meta')].find(x=>/^[A-Z][a-z]+ \\d{1,2}, \\d{4}$/.test(x.textContent.trim()))?.textContent.trim() || main.querySelector('header time')?.getAttribute('datetime') || '';
  const category = main.querySelector('a[href*="/news/"]')?.textContent.trim() || '';
  const url = document.querySelector('link[rel="canonical"]')?.href || document.querySelector('meta[property="og:url"]')?.getAttribute('content') || location.href;
  const parts=[];let stopped=false;
  const visit = el => {
    if(stopped)return;
    const tag=el.tagName, text=el.textContent.trim();
    if(text==='Keep reading'){stopped=true;return;}
    if(['SCRIPT','STYLE','NAV','ASIDE','BUTTON','HEADER','H1'].includes(tag)||el.hidden||el.getAttribute('aria-hidden')==='true')return;
    if(el.matches('.text-meta'))return;
    if(/^H[2-6]$/.test(tag)){if(text)parts.push('#'.repeat(Number(tag[1]))+' '+text);}
    else if(tag==='P'){if(text&&!/^(Listen to article|Share)$/.test(text))parts.push(text);}
    else if(tag==='PRE'){if(text)parts.push(String.fromCharCode(96).repeat(3)+'\\n'+text+'\\n'+String.fromCharCode(96).repeat(3));}
    else if(tag==='UL'||tag==='OL')parts.push([...el.children].filter(x=>x.tagName==='LI').map((x,i)=>(tag==='OL'?(i+1)+'. ':'- ')+x.textContent.trim()).join('\\n'));
    else if(tag==='BLOCKQUOTE'){if(text)parts.push('> '+text);}
    else if(tag==='TABLE'){for(const row of el.querySelectorAll('tr'))parts.push('| '+[...row.querySelectorAll('th,td')].map(x=>x.textContent.trim()).join(' | ')+' |');}
    else for(const child of el.children)visit(child);
  };
  const roots=[...main.querySelectorAll('[data-toc-content]')].filter(x=>!x.parentElement.closest('[data-toc-content]'));
  for(const root of roots.length?roots:[main])visit(root);
  const content=parts.filter(Boolean).join('\\n\\n');
  if(!title||!date||!Number.isFinite(Date.parse(date))||!content)throw new Error('OpenAI article: title, publication date or body missing: '+location.href);
  return [{title,date,category,url,content}];
})()
`
    }
  ],
};
