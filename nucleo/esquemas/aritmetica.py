"""Aritmética modular compartida: inverso por Euclides extendido y coeficientes de Lagrange en x = 0."""


def inverso_mod(a, p):
    """Inverso de `a` módulo `p` (algoritmo 3 del documento de Shamir: Euclides extendido).

    Lanza ValueError si `a` no es invertible (por ejemplo, a ≡ 0).
    """
    r0, r1 = p, a % p
    t0, t1 = 0, 1
    while r1 != 0:
        q = r0 // r1
        r0, r1 = r1, r0 - q * r1
        t0, t1 = t1, t0 - q * t1
    if r0 != 1:
        raise ValueError(f"{a} no es invertible módulo {p}")
    return t0 % p


def lagrange_en_cero(xs, p):
    """Coeficientes de Lagrange λ_j = ∏_{m≠j} x_m / (x_m − x_j) módulo p (ecuación 2).

    Dependen sólo de las abscisas, no de los valores de las partes.
    """
    lam = []
    for j, xj in enumerate(xs):
        num, den = 1, 1
        for m, xm in enumerate(xs):
            if m != j:
                num = num * xm % p
                den = den * (xm - xj) % p
        lam.append(num * inverso_mod(den, p) % p)
    return lam


def validar_abscisas(xs, p):
    """Las abscisas deben ser distintas y no nulas módulo p (si x = 0, la parte ES el secreto)."""
    reducidas = [x % p for x in xs]
    if 0 in reducidas:
        raise ValueError("abscisa nula: una parte en x = 0 sería el secreto completo")
    if len(set(reducidas)) != len(reducidas):
        raise ValueError("abscisas repetidas: dos partes son la misma")
