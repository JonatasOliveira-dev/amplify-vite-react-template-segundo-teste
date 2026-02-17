import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";

import "@aws-amplify/ui-react/styles.css";
import {
  Authenticator,
  ThemeProvider,
  createTheme,
  View,
  Image,
} from "@aws-amplify/ui-react";

import App from "./App";
import "./App.css";
import logo from "./assets/logo.png";

/**
 * Config híbrida do Amplify:
 * - DEV: lê ../amplify_outputs.json (sandbox/local)
 * - PROD: lê variáveis VITE_* (Amplify Hosting -> Variáveis de ambiente)
 */
async function configureAmplify() {
  // CONFIGURAÇÃO FORÇADA PARA USAR O AMBIENTE DA N. VIRGINIA
  const config = {
    API: {
      GraphQL: {
        endpoint: import.meta.env.VITE_APPSYNC_ENDPOINT,
        region: import.meta.env.VITE_AWS_REGION,
        defaultAuthMode: "userPool" as const,
      },
    },
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
      },
    },
  };

  Amplify.configure(config);
}// ✅ FECHA configureAmplify AQUI

/* ========= TEMA DO LOGIN ========= */
const theme = createTheme({
  name: "aquapower-theme",
  tokens: {
    colors: {
      background: {
        primary: { value: "#071225" },
        secondary: { value: "#0b1730" },
      },
      font: {
        primary: { value: "rgba(255,255,255,0.92)" },
        secondary: { value: "rgba(255,255,255,0.65)" },
      },
      brand: {
        primary: {
          10: "#0b1730",
          80: "#52d1ff",
          90: "#38bdf8",
          100: "#0ea5e9",
        },
      },
    },
    components: {
      button: {
        primary: {
          backgroundColor: { value: "#0ea5e9" },
          color: { value: "#ffffff" },
        },
      },
      tabs: {
        item: {
          _active: {
            color: { value: "#52d1ff" },
          },
        },
      },
    },
  },
});

async function start() {
  await configureAmplify();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <Authenticator
          components={{
            Header() {
              return (
                <View textAlign="center" padding="1.5rem">
                  <Image
                    alt="Aquapower"
                    src={logo}
                    width="120px"
                    margin="0 auto 1rem"
                  />
                </View>
              );
            },
          }}
        >
          {({ signOut }: { signOut?: () => void }) => (
            <App signOut={signOut} />
          )}
        </Authenticator>

      </ThemeProvider>
    </React.StrictMode>
  );
}

start().catch((err) => {
  console.error("Failed to start app:", err);
  document.body.innerHTML = `<pre style="padding:16px;color:#fff;background:#071225;white-space:pre-wrap;">${String(
    err?.message ?? err
  )}</pre>`;
});