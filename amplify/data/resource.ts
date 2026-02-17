import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

const schema = a.schema({
  // Definimos o modelo "DadosParque" para combinar com suas queries antigas,
  // mas com os campos novos da sua tabela
  DadosParque: a
    .model({
      device: a.string().required(),     // Partition Key
      timestamp: a.integer().required(), // Sort Key (Unix Timestamp)
      temperatura: a.float(),            // Seus dados novos
      humidade: a.float(),               // Seus dados novos
    })
    // Define a chave primária composta (Device + Timestamp)
    .identifier(["device", "timestamp"])
    .authorization((allow) => [
      allow.authenticated(), // Apenas usuários logados leem
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});