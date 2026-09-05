import { Route, Routes } from "react-router-dom";

import { Layout } from "./components/layout.tsx";
import { AboutPage } from "./pages/about.tsx";
import { BoardPage } from "./pages/board.tsx";
import { ProductPage } from "./pages/product.tsx";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/p/:id" element={<ProductPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<p className="py-16 text-center text-ink-soft">This page does not exist.</p>} />
      </Routes>
    </Layout>
  );
}
