import { useEffect, useState, useRef } from "react";
import "./App.css";

// Amplify & Auth
import { generateClient } from "aws-amplify/api";
import { fetchAuthSession } from "aws-amplify/auth";
import { latestReadings } from "./graphql/queries"; 
import MetricCard from "./components/MetricCard";

// AWS SDK para IoT (Shadow)
import { 
  IoTDataPlaneClient, 
  GetThingShadowCommand, 
  UpdateThingShadowCommand 
} from "@aws-sdk/client-iot-data-plane";

// Gráficos
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceArea,
} from "recharts";

const client = generateClient();

// --- TIPAGENS ---
type ChartData = {
  timestamp: number;
  temperatura: number | null;
  humidade: number | null;
};

// --- CONFIGURAÇÕES CRÍTICAS ---
// 1. ID usado para buscar dados no DynamoDB (Histórico)
const DYNAMO_DEVICE_ID = "device-01"; 

// 2. Configurações do AWS IoT Core (Comandos)
// Baseado na sua imagem do console AWS
const IOT_THING_NAME = "ESP32_Aquapower"; 
const IOT_SHADOW_NAME = "Shadow_teste";   // <--- O NOME DO SEU SHADOW

export default function App({ signOut }: { signOut?: () => void }) {
  // Controle de Abas
  const [activeTab, setActiveTab] = useState<"dashboard" | "comandos">("dashboard");
  
  // Dados do Dashboard (DynamoDB)
  const [latest, setLatest] = useState<ChartData | null>(null);
  const [history, setHistory] = useState<ChartData[]>([]);
  
  // --- ESTADOS DO SHADOW (COMANDOS) ---
  // O estado REAL que o dispositivo reportou ("ON" ou "OFF")
  const [reportedPumpState, setReportedPumpState] = useState<"ON" | "OFF">("OFF");
  
  // Estado de "Carregando" (Feedback Visual Amarelo)
  const [isPumpLoading, setIsPumpLoading] = useState(false);

  // Referência para o cliente IoT (para não recriar a cada render)
  const iotClientRef = useRef<IoTDataPlaneClient | null>(null);

  // =================================================================
  // 1. INICIALIZAÇÃO DO IOT E MONITORAMENTO (Polling do Shadow)
  // =================================================================
  useEffect(() => {
    const initIoT = async () => {
      try {
        // Pega as credenciais do usuário logado (Cognito)
        const { credentials } = await fetchAuthSession();
        if (!credentials) return;

        // Cria o cliente conectado à N. Virginia (us-east-1)
        iotClientRef.current = new IoTDataPlaneClient({
          region: import.meta.env.VITE_AWS_REGION,
          endpoint: import.meta.env.VITE_AWS_IOT_ENDPOINT, // Do seu .env.local
          credentials: credentials,
        });

        // Checa o estado inicial assim que conecta
        checkShadow();
      } catch (e) {
        console.error("Erro ao iniciar IoT Client:", e);
      }
    };

    initIoT();

    // Verifica o Shadow a cada 2 segundos para ver se o ESP32 respondeu
    const shadowInterval = setInterval(() => {
      checkShadow();
    }, 2000); 

    return () => clearInterval(shadowInterval);
  }, []);

  // Função para ler o Shadow da AWS
  const checkShadow = async () => {
    if (!iotClientRef.current) return;

    try {
      const command = new GetThingShadowCommand({ 
        thingName: IOT_THING_NAME,
        shadowName: IOT_SHADOW_NAME // <--- IMPORTANTE: Lê o shadow específico
      });
      
      const response = await iotClientRef.current.send(command);

      if (response.payload) {
        // Converte a resposta (Uint8Array) para JSON
        const str = new TextDecoder("utf-8").decode(response.payload);
        const shadow = JSON.parse(str);

        // Acessa o estado dentro do JSON do Shadow
        const reported = shadow.state?.reported?.bomba; 
        const desired = shadow.state?.desired?.bomba;

        // Atualiza o estado visual se tiver dados válidos
        if (reported === "ON" || reported === "OFF") {
          setReportedPumpState(reported);
        }

        // LÓGICA DE CONFIRMAÇÃO:
        // Se o que o dispositivo reportou (reported) for IGUAL ao que pedimos (desired),
        // significa que o comando foi executado. Paramos o loading.
        if (reported && desired && reported === desired) {
          setIsPumpLoading(false);
        }
      }
    } catch (e) {
      // Erros de conexão ou shadow inexistente (normal no início)
      // console.warn("Sync Shadow:", e);
    }
  };

  // =================================================================
  // 2. ENVIAR COMANDO (Publicar no Shadow)
  // =================================================================
  const togglePump = async () => {
    if (!iotClientRef.current || isPumpLoading) return;

    // Inverte o estado atual
    const targetState = reportedPumpState === "ON" ? "OFF" : "ON";

    // 1. Feedback Visual Imediato (Amarelo)
    setIsPumpLoading(true);
    console.log(`📡 Enviando comando: ${targetState}... para ${IOT_SHADOW_NAME}`);

    try {
      // 2. Monta o Payload do Shadow
      const payload = JSON.stringify({
        state: {
          desired: {
            bomba: targetState
          }
        }
      });

      // 3. Envia para a AWS
      const command = new UpdateThingShadowCommand({
        thingName: IOT_THING_NAME,
        shadowName: IOT_SHADOW_NAME, // <--- IMPORTANTE: Atualiza o shadow específico
        payload: new TextEncoder().encode(payload),
      });

      await iotClientRef.current.send(command);
      
      // Nota: Não setamos "setIsPumpLoading(false)" aqui.
      // Esperamos o useEffect (checkShadow) confirmar que o dispositivo obedeceu.

    } catch (error) {
      console.error("Erro ao enviar comando:", error);
      setIsPumpLoading(false); // Destrava o botão se der erro de rede
      alert("Erro ao comunicar com a AWS IoT. Verifique o Endpoint e Permissões.");
    }
  };

  // =================================================================
  // 3. BUSCA DE DADOS DO GRÁFICO (DynamoDB via AppSync)
  // =================================================================
  const fetchGraphData = async () => {
    try {
      const res: any = await client.graphql({
        query: latestReadings,
        variables: { deviceId: DYNAMO_DEVICE_ID, limit: 50 },
        authMode: "userPool",
      });
      const rawItems = res?.data?.latestReadings || [];
      
      const normalized = rawItems.map((item: any) => ({
        timestamp: Math.floor(item.timestamp_ms / 1000), // ms -> segundos
        temperatura: item.temperatura,
        humidade: item.humidade
      })).sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      setHistory(normalized);
      if (normalized.length > 0) {
        setLatest(normalized[normalized.length - 1]);
      }
    } catch (e) { 
      console.error("Erro no gráfico:", e); 
    }
  };

  useEffect(() => {
    fetchGraphData();
    const i = setInterval(fetchGraphData, 5000);
    return () => clearInterval(i);
  }, []);

  // =================================================================
  // 4. RENDERIZAÇÃO (UI)
  // =================================================================
  
  // Definição das classes e textos do botão da Bomba
  const isPumpOn = reportedPumpState === "ON";
  
  let btnClass = "btn-power";
  let statusText = "DESLIGADA";

  if (isPumpLoading) {
    btnClass += " pending"; // Amarelo (definido no CSS)
    statusText = "COMANDO ENVIADO...";
  } else if (isPumpOn) {
    btnClass += " active"; // Verde (definido no CSS)
    statusText = "BOMBA LIGADA (CONFIRMADO)";
  } else {
    // Cinza padrão
    statusText = "BOMBA DESLIGADA";
  }

  // Helpers do Gráfico (Zoom)
  const [left, setLeft] = useState<number | "dataMin">("dataMin");
  const [right, setRight] = useState<number | "dataMax">("dataMax");
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === null || refAreaLeft === null) {
      setRefAreaLeft(null); setRefAreaRight(null); return;
    }
    let [L, R] = [refAreaLeft, refAreaRight];
    if (L > R) [L, R] = [R, L];
    setRefAreaLeft(null); setRefAreaRight(null);
    setLeft(L); setRight(R);
  };
  const zoomOut = () => { setLeft("dataMin"); setRight("dataMax"); };

  return (
    <div className="ap-page">
      {/* HEADER */}
      <header className="ap-topbar">
        <div className="ap-brand"><span className="ap-brandText">MONITORAMENTO IOT</span></div>
        
        {/* Abas Centrais */}
        <div className="ap-tabs">
          <button 
            className={`ap-tab ${activeTab === 'dashboard' ? 'isActive' : ''}`} 
            onClick={() => setActiveTab('dashboard')}
          >
            Monitoramento
          </button>
          <button 
            className={`ap-tab ${activeTab === 'comandos' ? 'isActive' : ''}`} 
            onClick={() => setActiveTab('comandos')}
          >
            Comandos
          </button>
        </div>

        <div className="ap-actions">
           <div className="ap-pill"><span className="ap-pillText">{DYNAMO_DEVICE_ID}</span></div>
           {signOut && <button className="ap-signout" onClick={() => signOut()}>Sair</button>}
        </div>
      </header>

      <main className="ap-container">
        
        {/* --- ABA 1: MONITORAMENTO (Gráficos) --- */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
             <section className="ap-grid3">
              <MetricCard title="TEMPERATURA" value={latest?.temperatura} unit="°C" accent="orange" data={history} dataKey="temperatura" />
              <MetricCard title="UMIDADE" value={latest?.humidade} unit="%" accent="cyan" data={history} dataKey="humidade" />
              <MetricCard title="STATUS" valueText={latest ? "ONLINE" : "OFFLINE"} accent="green" hideSparkline />
            </section>

            <section style={{ height: 400, marginTop: 20, background: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 16 }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}>
                <span>Série Temporal (Últimos 50 pontos)</span>
                <button onClick={zoomOut} style={{background:'transparent', border:'1px solid #555', color:'#fff', borderRadius:4, cursor:'pointer'}}>Reset Zoom</button>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={history} 
                    onMouseDown={(e:any)=>setRefAreaLeft(e?.activeLabel)} 
                    onMouseMove={(e:any)=>refAreaLeft && setRefAreaRight(e?.activeLabel)} 
                    onMouseUp={zoom}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis 
                        dataKey="timestamp" 
                        domain={[left, right]} 
                        tickFormatter={(t)=>new Date(t*1000).toLocaleTimeString()} 
                        type="number" 
                        allowDataOverflow 
                    />
                    <YAxis />
                    <Tooltip labelFormatter={(t)=>new Date(t*1000).toLocaleString()} contentStyle={{backgroundColor:'#0b1730'}} />
                    <Legend />
                    <Line type="monotone" dataKey="temperatura" name="Temperatura" stroke="#f97316" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="humidade" name="Umidade" stroke="#06b6d4" dot={false} strokeWidth={2} />
                    
                    {refAreaLeft && refAreaRight ? (
                      <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#8884d8" />
                    ) : null}
                  </LineChart>
              </ResponsiveContainer>
            </section>
          </div>
        )}

        {/* --- ABA 2: COMANDOS (Shadow) --- */}
        {activeTab === 'comandos' && (
          <div className="fade-in">
            <h2 style={{fontSize: 18, color: 'rgba(255,255,255,0.7)', margin: '0 0 20px'}}>Controle Remoto (Shadow: {IOT_SHADOW_NAME})</h2>
            <div className="cmd-grid">
              
              {/* BOTÃO DA BOMBA INTELIGENTE */}
              <div className="cmd-card">
                <div className="cmd-title">Acionamento da Bomba</div>
                
                <button 
                  className={btnClass}
                  onClick={togglePump}
                  disabled={isPumpLoading} // Bloqueia clique se estiver pendente
                  title={isPumpLoading ? "Aguardando confirmação do dispositivo..." : "Clique para alternar"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                    <line x1="12" y1="2" x2="12" y2="12"></line>
                  </svg>
                </button>

                <div className={`status-indicator ${isPumpOn ? 'on' : ''}`} style={{marginTop: 15, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  {isPumpLoading && <span className="spin-loader"/>}
                  {statusText}
                </div>
              </div>

              {/* Botão Reset (Simples) */}
              <div className="cmd-card">
                <div className="cmd-title">Sistema</div>
                <div className="cmd-icon-wrapper" style={{color: '#ef4444'}}>
                   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </div>
                <button className="btn-reset" onClick={()=>alert("Reset não implementado na demonstração.")}>
                  REINICIAR DISPOSITIVO
                </button>
                <div className="status-indicator">
                   Reinicia o ESP32 remotamente
                </div>
              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}