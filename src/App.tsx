import { useEffect, useState } from "react";
import "./App.css";

import { generateClient } from "aws-amplify/api";
import { latestReadings } from "./graphql/queries"; 
import MetricCard from "./components/MetricCard";

// IMPORTANTE: Para enviar comandos reais, você precisará configurar o IoT Data Plane futuramente
// import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceArea,
} from "recharts";

const client = generateClient();

type Reading = {
  deviceId: string;
  timestamp_ms: number;
  temperatura: number | null;
  humidade: number | null;
};

type ChartData = {
  timestamp: number;
  temperatura: number | null;
  humidade: number | null;
};

type AppProps = { signOut?: (data?: unknown) => void; };

const DEVICE_ID = "device-01"; 

export default function App({ signOut }: AppProps) {
  // --- ESTADOS ---
  const [activeTab, setActiveTab] = useState<"dashboard" | "comandos">("dashboard");
  
  // Dashboard
  const [latest, setLatest] = useState<ChartData | null>(null);
  const [history, setHistory] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Comandos (Estados locais para simular a interface)
  const [pumpOn, setPumpOn] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Gráfico Zoom
  const [left, setLeft] = useState<number | "dataMin">("dataMin");
  const [right, setRight] = useState<number | "dataMax">("dataMax");
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);

  // --- BUSCA DE DADOS (DASHBOARD) ---
  async function fetchData() {
    setLoading(true);
    try {
      const res: any = await client.graphql({
        query: latestReadings,
        variables: { deviceId: DEVICE_ID, limit: 50 },
        authMode: "userPool",
      });

      const rawItems: Reading[] = res?.data?.latestReadings || [];

      const normalized: ChartData[] = rawItems.map((item) => ({
        timestamp: Math.floor(item.timestamp_ms / 1000), 
        temperatura: item.temperatura,
        humidade: item.humidade,
      }));

      normalized.sort((a, b) => a.timestamp - b.timestamp);
      setHistory(normalized);

      if (normalized.length > 0) {
        setLatest(normalized[normalized.length - 1]);
      }
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // --- FUNÇÕES DE COMANDO (MOCK / PLACEHOLDER) ---
  const togglePump = async () => {
    // AQUI ENTRARIA O CÓDIGO MQTT:
    // await iotClient.send(new PublishCommand({ topic: 'cmd/device-01', payload: ... }))
    
    // Simulação visual:
    const newState = !pumpOn;
    setPumpOn(newState);
    console.log(`Comando enviado: Bomba ${newState ? "LIGADA" : "DESLIGADA"}`);
  };

  const handleReset = async () => {
    if(!window.confirm("Tem certeza que deseja reiniciar o dispositivo?")) return;
    
    setResetting(true);
    console.log("Comando enviado: RESET");
    
    // Simula delay do reset
    setTimeout(() => {
      setResetting(false);
      alert("Comando de Reset enviado com sucesso!");
    }, 2000);
  };

  // Helpers do Gráfico
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
  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString();

  return (
    <div className="ap-page">
      {/* --- HEADER COM ABAS --- */}
      <header className="ap-topbar">
        <div className="ap-brand">
          <span className="ap-brandText">MONITORAMENTO IOT</span>
        </div>

        {/* ABAS CENTRAIS */}
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
           <div className="ap-pill"><span className="ap-pillText">{DEVICE_ID}</span></div>
           {signOut && <button className="ap-signout" onClick={() => signOut()}>Sair</button>}
        </div>
      </header>

      <main className="ap-container">
        
        {/* --- VIEW: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
             <section className="ap-grid3">
              <MetricCard
                title="TEMPERATURA"
                value={latest?.temperatura}
                unit="°C"
                accent="orange"
                data={history}
                dataKey="temperatura"
              />
              <MetricCard
                title="UMIDADE"
                value={latest?.humidade}
                unit="%"
                accent="cyan"
                data={history}
                dataKey="humidade"
              />
              <MetricCard
                title="STATUS"
                valueText={latest ? "ONLINE" : "AGUARDANDO"}
                accent="green"
                hideSparkline
              />
            </section>

            <section style={{ height: 400, marginTop: 20, background: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 16 }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}>
                <span>Série Temporal (Últimos 50 pontos)</span>
                <button onClick={zoomOut} style={{background:'transparent', border:'1px solid #555', color:'#fff', borderRadius:4, cursor:'pointer'}}>Reset Zoom</button>
              </div>
              
              <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={history}
                    onMouseDown={(e: any) => e && setRefAreaLeft(e.activeLabel)}
                    onMouseMove={(e: any) => refAreaLeft && setRefAreaRight(e.activeLabel)}
                    onMouseUp={zoom}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis 
                        dataKey="timestamp" 
                        domain={[left, right]} 
                        tickFormatter={formatTime} 
                        type="number" 
                        allowDataOverflow
                    />
                    <YAxis />
                    <Tooltip 
                        labelFormatter={(t) => new Date(t*1000).toLocaleString()} 
                        contentStyle={{backgroundColor: '#0b1730', borderColor: '#333'}}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="temperatura" name="Temperatura (°C)" stroke="#f97316" dot={false} strokeWidth={2} animationDuration={300} />
                    <Line type="monotone" dataKey="humidade" name="Umidade (%)" stroke="#06b6d4" dot={false} strokeWidth={2} animationDuration={300} />
                    
                    {refAreaLeft && refAreaRight ? (
                      <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#8884d8" />
                    ) : null}
                  </LineChart>
              </ResponsiveContainer>
            </section>
          </div>
        )}

        {/* --- VIEW: COMANDOS --- */}
        {activeTab === 'comandos' && (
          <div className="fade-in">
            <h2 style={{fontSize: 18, color: 'rgba(255,255,255,0.7)', margin: '0 0 20px'}}>Controle Remoto</h2>
            
            <div className="cmd-grid">
              
              {/* Card da Bomba */}
              <div className="cmd-card">
                <div className="cmd-title">Acionamento da Bomba</div>
                <button 
                  className={`btn-power ${pumpOn ? 'active' : ''}`}
                  onClick={togglePump}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                    <line x1="12" y1="2" x2="12" y2="12"></line>
                  </svg>
                </button>
                <div className={`status-indicator ${pumpOn ? 'on' : ''}`}>
                  {pumpOn ? "BOMBA ATIVA" : "BOMBA DESLIGADA"}
                </div>
              </div>

              {/* Card de Reset */}
              <div className="cmd-card">
                <div className="cmd-title">Reinicialização</div>
                <div className="cmd-icon-wrapper" style={{color: '#ef4444'}}>
                   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </div>
                <button 
                  className="btn-reset"
                  onClick={handleReset}
                  disabled={resetting}
                >
                  {resetting ? "REINICIANDO..." : "REINICIAR DISPOSITIVO"}
                </button>
                <div className="status-indicator">
                  Use com cautela
                </div>
              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}