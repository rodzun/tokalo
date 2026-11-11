from workers import WorkerEntrypoint, Response


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        destino = None
        try:
            partes = request.url.split("?", 1)[0].split("/")
            # https://host/n/CODIGO -> ['https:', '', 'host', 'n', 'CODIGO']
            if len(partes) == 5 and partes[3] in ("n", "q"):
                codigo = partes[4].upper()
                valor = await (
                    self.env.DB.prepare("SELECT destino FROM placas WHERE codigo = ?")
                    .bind(codigo)
                    .first("destino")
                )
                if isinstance(valor, str):
                    destino = valor
        except Exception:
            destino = None
        return Response(
            "",
            status=302,
            headers={"Location": destino or "/", "Cache-Control": "no-store"},
        )
