"""Límites y valores por defecto del simulador."""

N_MIN, N_MAX = 10, 20            # nodos permitidos desde la interfaz/API
DIF_MIN, DIF_MAX = 3, 5          # ceros hexadecimales (API); el núcleo admite 1..8
DIF_DEFECTO = 4
CONF_POW = 6                     # confirmaciones para acreditar una recompensa PoW
CONF_POS = 0                     # en PoS la recompensa se paga al aceptar el bloque
RECOMPENSA_DEFECTO = 50
RECOMPENSA_MAX = 1_000_000
SALDO_DEFECTO = 100
SALDO_MAX = 1_000_000
MONTO_MAX = 10**9
MAX_PENDIENTES = 50
MAX_TX_BLOQUE = 8
MAX_ALTURA = 200
K_MAX = 2000                     # nonces por minero y por ronda
MAX_RONDAS_DEFECTO = 2000
MAX_RONDAS_MAX = 100_000
PAUSA_MS_DEFECTO = 40
PAUSA_MS_MAX = 500
BITACORA_MAX = 1000
T0 = "2026-01-01T00:00:00Z"      # el reloj lógico arranca aquí (determinismo)
UMBRAL_NUM, UMBRAL_DEN = 2, 3    # votos a favor >= 2/3 de lo apostado: 3V >= 2A
ALFA_PM_DEFECTO = 500            # regla B: alfa = 0.5 (en milésimas)
MODOS = ("pow", "pos")
VERSION = "1.0"
