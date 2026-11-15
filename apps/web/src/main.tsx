import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import Dashboard from "./pages/Dashboard";
import Responder from "./pages/Responder";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/responder" element={<Responder />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
