import React from "react";
import ReactDOM from "react-dom/client";
import { AppProvider } from "./app/providers";
import App from "./app/App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
