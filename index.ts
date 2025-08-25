import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";

const app = express();

// Enable CORS for frontend (development and production)
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:5173', // Development
    'http://localhost:5174', // Development
    'http://localhost:3000', // Alternative dev port
    process.env.FRONTEND_URL, // Production frontend from env
    'https://avgx.vercel.app', // Production frontend (update this to your actual domain)
    'https://avgx-frontend.vercel.app' // Alternative production domain
  ].filter(Boolean); // Remove undefined values
  
  const origin = req.headers.origin;
  
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.length > 0) {
    // Fallback to first allowed origin if no match
    res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(`[${new Date().toLocaleTimeString()}] ${logLine}`);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error("Error:", err);
  });

  // API-only server - no frontend serving
  app.use("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ message: "API endpoint not found" });
    } else {
      res.status(404).json({ message: "Frontend not served by this server. Please run the frontend separately." });
    }
  });

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    console.log(`[${new Date().toLocaleTimeString()}] Backend API server running on port ${port}`);
    console.log(`[${new Date().toLocaleTimeString()}] API endpoints available at http://localhost:${port}/api/*`);
    console.log(`[${new Date().toLocaleTimeString()}] CORS enabled for frontend at http://localhost:5173`);
  });
})(); 