import {Hono} from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { join } from "path";
import { readdirSync } from "fs";
const app = new Hono();
app.use(cors());
app.use(prettyJSON());

const apiDir = join(import.meta.dir, "api");

const versions = readdirSync(apiDir);
for (const version of versions) {
  const versionPath = join(apiDir, version);
  const resources = readdirSync(versionPath);
  for (const resource of resources) {
    const resourcePath = join(versionPath, resource);
    const resourceName = resource.replace(".ts", "");
    const resourceRouter = (await import(resourcePath)).default;
    app.route(`/api/${version}/${resourceName}`, resourceRouter);
  }
}

app.all("*", (c) => c.text("Not Found", 404));
export default { 
  port: process.env.PORT || 3002, 
  fetch: app.fetch, 
};