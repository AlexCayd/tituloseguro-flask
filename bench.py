"""Cronómetro: mide el tiempo promedio de minado por dificultad sobre cadenas desechables en memoria."""
import statistics
import threading

from blockchain import DIFICULTADES_PERMITIDAS, Billetera, Cadena, Ronda, crear_nodos

RONDAS_POR_DEFECTO = {3: 30, 4: 20, 5: 8}
MAX_RONDAS = 60


class Cronometro:
    def __init__(self):
        self.activo = False
        self._cancelar = False
        self._ronda = None
        self.estado = self._vacio()
        self._hilo = None
        self._cierre = threading.Lock()

    @staticmethod
    def _vacio():
        return {"activo": False, "plan": {}, "actual": None, "hechas": 0, "total": 0,
                "resultados": {}, "terminado": False, "cancelado": False}

    def iniciar(self, rondas=None):
        """rondas: {dificultad: n}. Devuelve False si ya hay una medición en curso."""
        plan = {}
        for d, n in (rondas or RONDAS_POR_DEFECTO).items():
            d, n = int(d), int(n)
            if d not in DIFICULTADES_PERMITIDAS:
                raise ValueError(f"Dificultad no permitida: {d}")
            if not 1 <= n <= MAX_RONDAS:
                raise ValueError(f"Las rondas deben estar entre 1 y {MAX_RONDAS}.")
            plan[d] = n
        with self._cierre:
            if self.activo:
                return False
            self.activo, self._cancelar = True, False
            self.estado = {**self._vacio(), "activo": True, "plan": plan, "total": sum(plan.values())}
        self._hilo = threading.Thread(target=self._correr, args=(plan,), daemon=True)
        self._hilo.start()
        return True

    def cancelar(self):
        self._cancelar = True
        if self._ronda:
            self._ronda.fin.set()

    def _correr(self, plan):
        try:
            for d in sorted(plan):
                tiempos, intentos, tasas = [], [], []
                self.estado["actual"] = {"dificultad": d, "ronda": 0, "de": plan[d]}
                for k in range(plan[d]):
                    if self._cancelar:
                        break
                    self.estado["actual"]["ronda"] = k + 1
                    cadena, w = Cadena(), Billetera()  # cadena desechable: la real ni se entera
                    tx = {"proposito": "benchmark", "remitente": w.pub,
                          "contenido": {"ronda": k}, "hora": "2026-01-01T00:00:00Z"}
                    nodos = crear_nodos()
                    r = Ronda(cadena, tx, w.firmar(tx), d, nodos)
                    self._ronda = r
                    r.iniciar()
                    r.esperar()
                    if self._cancelar or r.estado["ganador"] is None:
                        break
                    dt = r.t1 - r.t0
                    n_int = sum(n.intentos for n in nodos)
                    tiempos.append(dt)
                    intentos.append(n_int)
                    tasas.append(n_int / dt)
                    self.estado["hechas"] += 1
                    self.estado["resultados"][d] = self._resumen(d, tiempos, intentos, tasas)
        finally:
            self._ronda = None
            self.estado["activo"] = False
            self.estado["terminado"] = not self._cancelar
            self.estado["cancelado"] = self._cancelar
            self.activo = False

    @staticmethod
    def _resumen(d, tiempos, intentos, tasas):
        return {
            "dificultad": d,
            "rondas": len(tiempos),
            "tiempo_medio": round(statistics.fmean(tiempos), 3),
            "tiempo_min": round(min(tiempos), 3),
            "tiempo_max": round(max(tiempos), 3),
            "intentos_medios": round(statistics.fmean(intentos)),
            "intentos_teoricos": 16 ** d,
            "hashrate_medio": round(statistics.fmean(tasas)),
        }
