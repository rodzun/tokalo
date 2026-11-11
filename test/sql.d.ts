// Permite importar un archivo .sql como texto:  import sql from "x.sql?raw"
declare module "*.sql?raw" {
  const texto: string;
  export default texto;
}
