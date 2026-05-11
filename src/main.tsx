import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SolanaWalletProvider } from "./SolanaWalletProvider";
import "./styles.css";
import "@solana/wallet-adapter-react-ui/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SolanaWalletProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SolanaWalletProvider>
  </React.StrictMode>,
);
