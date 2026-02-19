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

// --- CONFIGURAÇÕES ---
const DYNAMO_DEVICE_ID = "device-01"; 
const IOT_THING_NAME = "ESP32_Aquapower"; 
const IOT_SHADOW_NAME = "Shadow_teste";

export default function App({ signOut }: { signOut?: () => void }) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "comandos">("dashboard");
  
  // Dashboard Data
  const [latest, setLatest] = useState<ChartData | null>(null);
  const [history, setHistory] = useState<ChartData[]>([]);
  
  // --- ESTADOS DO SHADOW ---
  // Bomba
  const [reportedPumpState, setReportedPumpState] = useState<"ON" | "OFF">("OFF");
  const [isPumpLoading, setIsPumpLoading] = useState(false);

  // Intervalo
  const [reportedInterval, setReportedInterval] = useState<number>(10); // Valor atual no dispositivo
  const [inputInterval, setInputInterval] = useState<string>("10");     // Valor digitado no input
  const [isIntervalLoading, setIsIntervalLoading] = useState(false);

  const iotClientRef = useRef<IoTDataPlaneClient | null>(null);

 // 1. INICIALIZAÇÃO IOT
  useEffect(() => {
    const initIoT = async () => {
      try {
        const { credentials, identityId } = await fetchAuthSession();
        console.log("🔍 DEBUG CREDENCIAIS:", { identityId, temAccessKey: !!credentials?.accessKeyId });

        if (!credentials) return;

        // TRUQUE 1: Limpar espaços em branco e barras inúteis da URL do .env
        const rawEndpoint = import.meta.env.VITE_AWS_IOT_ENDPOINT || "";
        const cleanEndpoint = rawEndpoint.trim().replace(/\/$/, "");
        
        // TRUQUE 2: Limpar a Região
        const cleanRegion = import.meta.env.VITE_AWS_REGION?.trim();

        // TRUQUE 3: Desestruturar as credenciais para o SDK não se confundir
        iotClientRef.current = new IoTDataPlaneClient({
          region: cleanRegion,
          endpoint: cleanEndpoint,
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken
          },
        });

        checkShadow();
      } catch (e) {
        console.error("Erro IoT Client:", e);
      }
    };

    initIoT();

    // Verifica o Shadow a cada 2 segundos para ver se o ESP32 respondeu
    const shadowInterval = setInterval(() => {
      checkShadow();
    }, 2000); 

    return () => clearInterval(shadowInterval);
  }, []);

  // 2. LER SHADOW (Pooling)
  const checkShadow = async () => {
    if (!iotClientRef.current) return;

    try {
      const command = new GetThingShadowCommand({ 
        thingName: IOT_THING_NAME,
        shadowName: IOT_SHADOW_NAME 
      });
      
      const response = await iotClientRef.current.send(command);

      if (response.payload) {
        const str = new TextDecoder("utf-8").decode(response.payload);
        const shadow = JSON.parse(str);
        
        // --- LÓGICA BOMBA ---
        const repPump = shadow.state?.reported?.bomba; 
        const desPump = shadow.state?.desired?.bomba;
        if (repPump) setReportedPumpState(repPump);
        if (repPump && desPump && repPump === desPump) setIsPumpLoading(false);

        // --- LÓGICA INTERVALO ---
        const repInt = shadow.state?.reported?.intervalo_envio;
        const desInt = shadow.state?.desired?.intervalo_envio;
        
        if (typeof repInt === 'number') {
            setReportedInterval(repInt);
            // Se não estiver editando (loading), sincroniza o input com o valor real
            if (!isIntervalLoading && inputInterval === "") setInputInterval(repInt.toString());
        }

        // Se o valor reportado for igual ao desejado, acabou o loading
        if (repInt && desInt && repInt === desInt) {
            setIsIntervalLoading(false);
        }
      }
    } catch (e) { }
  };

  // 3. ENVIAR COMANDO BOMBA
  const togglePump = async () => {
    if (!iotClientRef.current || isPumpLoading) return;
    const targetState = reportedPumpState === "ON" ? "OFF" : "ON";
    setIsPumpLoading(true);

    sendShadowUpdate({ bomba: targetState });
  };

  // 4. ENVIAR COMANDO INTERVALO
  const updateInterval = async () => {
    if (!iotClientRef.current || isIntervalLoading) return;
    
    const val = parseInt(inputInterval);
    if (isNaN(val) || val < 1) {
        alert("Digite um número válido (mínimo 1s)");
        return;
    }

    setIsIntervalLoading(true);
    sendShadowUpdate({ intervalo_envio: val });
  };

  // Função genérica de envio
  const sendShadowUpdate = async (stateObject: any) => {
      try {
        const payload = JSON.stringify({
            state: { desired: stateObject }
        });

        const command = new UpdateThingShadowCommand({
            thingName: IOT_THING_NAME,
            shadowName: IOT_SHADOW_NAME,
            payload: new TextEncoder().encode(payload),
        });

        await iotClientRef.current?.send(command);
      } catch (error) {
        console.error("Erro envio:", error);
        setIsPumpLoading(false);
        setIsIntervalLoading(false);
      }
  }

  // 5. FETCH DYNAMO
  const fetchGraphData = async () => {
    try {
      const res: any = await client.graphql({
        query: latestReadings,
        variables: { deviceId: DYNAMO_DEVICE_ID, limit: 50 },
        authMode: "userPool",
      });
      const raw = res?.data?.latestReadings || [];
      const norm = raw.map((i: any) => ({
        timestamp: Math.floor(i.timestamp_ms / 1000),
        temperatura: i.temperatura,
        humidade: i.humidade
      })).sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      setHistory(norm);
      if (norm.length > 0) setLatest(norm[norm.length - 1]);
    } catch (e) { }
  };

  useEffect(() => {
    fetchGraphData();
    const i = setInterval(fetchGraphData, 5000);
    return () => clearInterval(i);
  }, []);

  // UI Helpers
  const isPumpOn = reportedPumpState === "ON";
  let btnPumpClass = "btn-power" + (isPumpLoading ? " pending" : isPumpOn ? " active" : "");
  
  // Helpers Zoom
  const [left, setLeft] = useState<number | "dataMin">("dataMin");
  const [right, setRight] = useState<number | "dataMax">("dataMax");
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const zoom = () => { setRefAreaLeft(null); setRefAreaRight(null); setLeft(refAreaLeft||"dataMin"); setRight(refAreaRight||"dataMax"); };
  const zoomOut = () => { setLeft("dataMin"); setRight("dataMax"); };

  return (
    <div className="ap-page">
      <header className="ap-topbar">
        <div className="ap-brand"><span className="ap-brandText">MONITORAMENTO IOT</span></div>
        <div className="ap-tabs">
          <button className={`ap-tab ${activeTab === 'dashboard' ? 'isActive' : ''}`} onClick={() => setActiveTab('dashboard')}>Monitoramento</button>
          <button className={`ap-tab ${activeTab === 'comandos' ? 'isActive' : ''}`} onClick={() => setActiveTab('comandos')}>Comandos</button>
        </div>
        <div className="ap-actions">
           <div className="ap-pill"><span className="ap-pillText">{DYNAMO_DEVICE_ID}</span></div>
           {signOut && <button className="ap-signout" onClick={() => signOut()}>Sair</button>}
        </div>
      </header>

      <main className="ap-container">
        
        {/* ABA DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
             <section className="ap-grid3">
              <MetricCard title="TEMPERATURA" value={latest?.temperatura} unit="°C" accent="orange" data={history} dataKey="temperatura" />
              <MetricCard title="UMIDADE" value={latest?.humidade} unit="%" accent="cyan" data={history} dataKey="humidade" />
              <MetricCard title="STATUS" valueText={latest ? "ONLINE" : "OFFLINE"} accent="green" hideSparkline />
            </section>
            <section style={{ height: 400, marginTop: 20, background: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 16 }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}>
                <span>Série Temporal (Atual: {reportedInterval}s)</span>
                <button onClick={zoomOut} style={{background:'transparent', border:'1px solid #555', color:'#fff', borderRadius:4, cursor:'pointer'}}>Reset</button>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} onMouseDown={(e:any)=>setRefAreaLeft(e?.activeLabel)} onMouseMove={(e:any)=>refAreaLeft && setRefAreaRight(e?.activeLabel)} onMouseUp={zoom}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis dataKey="timestamp" domain={[left, right]} tickFormatter={(t)=>new Date(t*1000).toLocaleTimeString()} type="number" allowDataOverflow />
                    <YAxis />
                    <Tooltip labelFormatter={(t)=>new Date(t*1000).toLocaleString()} contentStyle={{backgroundColor:'#0b1730'}} />
                    <Legend />
                    <Line type="monotone" dataKey="temperatura" stroke="#f97316" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="humidade" stroke="#06b6d4" dot={false} strokeWidth={2} />
                    {refAreaLeft && refAreaRight ? <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#8884d8" /> : null}
                  </LineChart>
              </ResponsiveContainer>
            </section>
          </div>
        )}

        {/* ABA COMANDOS */}
        {activeTab === 'comandos' && (
          <div className="fade-in">
            <h2 style={{fontSize: 18, color: 'rgba(255,255,255,0.7)', margin: '0 0 20px'}}>Controle Shadow</h2>
            <div className="cmd-grid">
              
              {/* CARD BOMBA */}
              <div className="cmd-card">
                <div className="cmd-title">Bomba (GPIO 18)</div>
                <button className={btnPumpClass} onClick={togglePump} disabled={isPumpLoading}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                </button>
                <div className={`status-indicator ${isPumpOn ? 'on' : ''}`} style={{marginTop: 15, display:'flex', justifyContent:'center'}}>
                  {isPumpLoading && <span className="spin-loader"/>} {isPumpLoading ? "ENVIANDO..." : isPumpOn ? "LIGADA" : "DESLIGADA"}
                </div>
              </div>

              {/* CARD INTERVALO */}
              <div className="cmd-card">
                <div className="cmd-title">Intervalo de Envio</div>
                <div style={{fontSize: 42, fontWeight: 800, color: '#38bdf8', marginBottom: 10}}>
                   {reportedInterval}<span style={{fontSize:16, opacity:0.6}}>s</span>
                </div>
                
                <div style={{display:'flex', gap:10, width:'100%'}}>
                    <input 
                        type="number" 
                        value={inputInterval}
                        onChange={(e) => setInputInterval(e.target.value)}
                        className="ap-date-input" 
                        style={{textAlign:'center', fontSize: 16, minWidth:0}}
                    />
                    <button 
                        className="ap-btn-search" 
                        onClick={updateInterval}
                        disabled={isIntervalLoading}
                        style={{flex:1, opacity: isIntervalLoading ? 0.5 : 1}}
                    >
                       {isIntervalLoading ? "..." : "SET"}
                    </button>
                </div>
                <div className="status-indicator" style={{marginTop: 15, minHeight: 20}}>
                   {isIntervalLoading ? "Atualizando..." : "Sincronizado"}
                </div>
              </div>

              {/* CARD RESET */}
              <div className="cmd-card">
                <div className="cmd-title">Sistema</div>
                <div className="cmd-icon-wrapper" style={{color: '#ef4444'}}>
                   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </div>
                <button className="btn-reset" onClick={()=>alert("Reset não implementado.")}>REINICIAR</button>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}