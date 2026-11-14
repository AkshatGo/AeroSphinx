import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme";
import { AppShell } from "@/components/layout/AppShell";
import { CommandCenter } from "@/modules/command-center/CommandCenter";
import { ResearchLab } from "@/modules/research-lab/ResearchLab";
import { DataObservatory } from "@/modules/data-observatory/DataObservatory";
import { ValidationMatrix } from "@/modules/validation-matrix/ValidationMatrix";
import { DefectRegister } from "@/modules/defect-register/DefectRegister";
import { ModelIntelligence } from "@/modules/model-intelligence/ModelIntelligence";
import { ForecastStudio } from "@/modules/forecast-studio/ForecastStudio";
import { AtmosphericExplorer } from "@/modules/atmospheric-explorer/AtmosphericExplorer";
import { Reports } from "@/modules/reports/Reports";
import { Settings } from "@/modules/settings/Settings";
import { EmptyState } from "@/components/ui/primitives";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <CommandCenter /> },
      { path: "research-lab", element: <ResearchLab /> },
      { path: "data-observatory", element: <DataObservatory /> },
      { path: "validation-matrix", element: <ValidationMatrix /> },
      { path: "defect-register", element: <DefectRegister /> },
      { path: "model-intelligence", element: <ModelIntelligence /> },
      { path: "forecast-studio", element: <ForecastStudio /> },
      { path: "atmospheric-explorer", element: <AtmosphericExplorer /> },
      { path: "reports", element: <Reports /> },
      { path: "settings", element: <Settings /> },
      {
        path: "*",
        element: (
          <EmptyState
            title="Page not found"
            description="This route does not exist. Use the navigation to return to a module."
          />
        ),
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);