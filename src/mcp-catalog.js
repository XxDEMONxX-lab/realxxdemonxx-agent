const entry=(name,description,command,args,requirements=[],platform="Node.js")=>({name,description,command,args,requirements,platform});
export const MCP_CATALOG=[
 entry("context7","Up-to-date library documentation","npx",["-y","@upstash/context7-mcp"],["Internet access"]),
 entry("github","GitHub repositories, issues and pull requests","npx",["-y","@modelcontextprotocol/server-github"],["GITHUB_PERSONAL_ACCESS_TOKEN","Internet access"]),
 entry("filesystem","Scoped local filesystem access","npx",["-y","@modelcontextprotocol/server-filesystem","."],["Workspace path"]),
 entry("fetch","Fetch public web pages","npx",["-y","@modelcontextprotocol/server-fetch"],["Internet access"]),
 entry("sequential-thinking","Structured multi-step planning","npx",["-y","@modelcontextprotocol/server-sequential-thinking"],[]),
 entry("playwright","Browser automation and UI testing","npx",["-y","@playwright/mcp"],["A supported browser installation or remote browser"]),
 entry("chrome-devtools","Chrome debugging, network and performance inspection","npx",["-y","chrome-devtools-mcp@latest"],["Chrome/Chromium browser environment"]),
 entry("sentry","Sentry issue and error investigation","npx",["-y","@sentry/mcp-server"],["Sentry authentication and project access"]),
 entry("postgres","PostgreSQL schema and query tools","npx",["-y","@modelcontextprotocol/server-postgres","${POSTGRES_URL}"],["Export POSTGRES_URL in Termux; use a least-privilege database account"]),
 entry("serena","Semantic code navigation and refactoring","uvx",["--from","git+https://github.com/oraios/serena","serena-mcp-server"],["Python uv/uvx and project configuration"],"Python/uv")
];
export function listMcpCatalog(){
 return MCP_CATALOG.map(item=>({name:item.name,description:item.description,command:item.command,args:item.args,requirements:item.requirements,platform:item.platform}));
}
export function getMcpTemplate(name){
 const item=MCP_CATALOG.find(x=>x.name===String(name||"").toLowerCase());
 if(!item)throw new Error("Unknown MCP template. Run /mcp-catalog to see available integrations.");
 return {...item,args:[...item.args],env:{}};
}
