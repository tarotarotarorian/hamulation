import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WhiteningSimulator from "./WhiteningSimulator.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WhiteningSimulator />
  </StrictMode>
);
