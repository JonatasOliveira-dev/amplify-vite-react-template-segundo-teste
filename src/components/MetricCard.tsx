import { ResponsiveContainer, LineChart, Line } from "recharts";

// Simplificamos para aceitar qualquer chave string, ou definimos as novas
export type MetricData = {
  timestamp: number;
  [key: string]: any; // Permite temperatura, humidade, etc.
};

type Props = {
  title: string;
  value?: number | null;
  unit?: string;
  accent: "blue" | "green" | "purple" | "cyan" | "orange" | "yellow";
  data?: MetricData[];     // Histórico
  dataKey?: string;        // Qual campo do histórico plotar (ex: "temperatura")
  hideSparkline?: boolean;
  valueText?: string;
};

export default function MetricCard({
  title,
  value,
  valueText,
  unit = "",
  accent,
  data = [],
  dataKey,
  hideSparkline,
}: Props) {
  const formatted = valueText ?? (typeof value === "number" ? value.toFixed(2) : "--");

  const spark =
    !hideSparkline && dataKey && data.length > 0
      ? data.map((d) => ({
          t: d.timestamp,
          v: d[dataKey] ?? null,
        }))
      : [];

  return (
    <div className="ap-metric">
      <div className="ap-metricTop">
        <div className="ap-metricTitle">{title}</div>
        <div className={`ap-metricIcon ${accent}`} />
      </div>

      <div className={`ap-metricValue ${valueText ? "text" : ""}`}>
        {formatted} <span className="ap-unit">{unit}</span>
      </div>

      {!hideSparkline && spark.length >= 2 ? (
        <div style={{ height: 34, marginTop: 6, opacity: 0.95 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark}>
              <Line type="monotone" dataKey="v" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="ap-progress" style={{ marginTop: 10 }}>
          <div className={`ap-progressBar ${accent}`} />
        </div>
      )}
    </div>
  );
}