import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./host.css";

createRoot(document.getElementById("root")!).render(<App />);
