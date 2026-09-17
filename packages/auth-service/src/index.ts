import express from "express";
import cors from "cors";

// WIP: user accounts are not implemented yet. Meetings currently use anonymous
// browser IDs (see room-service). Enable with: docker compose --profile auth up
const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`auth-service listening on :${port}`);
});
