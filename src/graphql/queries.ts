/* O nome da query aqui DEVE ser igual ao do seu AppSync (imagem c0eeb5.png) */
export const latestReadings = /* GraphQL */ `
  query LatestReadings($deviceId: String!, $limit: Int) {
    latestReadings(deviceId: $deviceId, limit: $limit) {
      deviceId
      timestamp_ms
      temperatura
      humidade
    }
  }
`;