import { Route, Routes } from "react-router-dom";

import { Layout } from "@/components/layout";
import { AboutPage } from "@/pages/about";
import { BasketPage } from "@/pages/basket";
import { BoardPage } from "@/pages/board";
import { ProductPage } from "@/pages/product";
import { RecipePage } from "@/pages/recipe";
import { RecipesPage } from "@/pages/recipes";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/p/:id" element={<ProductPage />} />
        <Route path="/basket" element={<BasketPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/r/:id" element={<RecipePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<p className="py-16 text-center text-muted-foreground">This page does not exist.</p>} />
      </Routes>
    </Layout>
  );
}
