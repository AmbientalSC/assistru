#!/usr/bin/env python3
"""Obter token da API SofitView automaticamente.

Estratégia:
- Tenta endpoints REST comuns com payloads {email,password} e {username,password}.
- Tenta mutações GraphQL comuns (login/authenticate/signIn) no endpoint `/api/v2/graphql`.
- Lê credenciais de `SOFIT_USER`/`SOFIT_PASS` ou solicita interativamente.

Uso:
 - Defina variáveis de ambiente (opcional):
         $env:SOFIT_USER = "seu_email"
         $env:SOFIT_PASS = "sua_senha"
     Em seguida rode: `python ./get_token.py`

Saída:
 - Exibe o token encontrado e imprime o comando PowerShell para exportar `SOFIT_TOKEN`.

Defina `DEBUG=1` no ambiente para ver respostas completas das requisições (útil para depuração).
"""

import os
import sys
import json
import getpass
import requests
from typing import Any


def find_token(o: Any):
    """Recursively procura por valores que pareçam tokens em um objeto JSON."""
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (str,)):
                key = k.lower()
                if key in ("token", "access_token", "accesstoken", "jwt", "id_token") or "token" in key or "access" in key:
                    return v
            t = find_token(v)
            if t:
                return t
    elif isinstance(o, list):
        for it in o:
            t = find_token(it)
            if t:
                return t
    return None


def try_rest(base_url: str, user: str, password: str):
    paths = [
        "/api/v2/auth/login",
        "/api/v2/login",
        "/api/v1/users/login",
        "/api/v1/login",
        "/api/auth/login",
        "/login",
    ]
    payloads = [
        {"email": user, "password": password},
        {"username": user, "password": password},
        {"user_name": user, "password": password},
        {"user": user, "password": password},
    ]

    headers = {"Content-Type": "application/json"}

    for p in paths:
        url = base_url.rstrip("/") + p
        for pay in payloads:
            try:
                r = requests.post(url, headers=headers, json=pay, timeout=10)
            except Exception:
                continue
            # debug output opcional
            if os.getenv("DEBUG") == "1":
                try:
                    print(f"DEBUG: POST {url} payload={pay} -> status={r.status_code}")
                    print(f"DEBUG: response text: {r.text[:1000]}")
                except Exception:
                    pass
            try:
                j = r.json()
            except Exception:
                j = None
            if j:
                t = find_token(j)
                if t:
                    return t, url, "rest"
    return None, None, None


def try_graphql(base_url: str, user: str, password: str):
    url = base_url.rstrip("/") + "/api/v2/graphql"
    mutations = [
        (
            "login",
            "mutation($email:String!,$password:String!){ login(email:$email,password:$password){ token access_token jwt } }",
        ),
        (
            "authenticate",
            "mutation($email:String!,$password:String!){ authenticate(email:$email,password:$password){ token access_token jwt } }",
        ),
        (
            "signIn",
            "mutation($email:String!,$password:String!){ signIn(email:$email,password:$password){ token access_token jwt } }",
        ),
    ]

    headers = {"Content-Type": "application/json"}

    for name, q in mutations:
        body = {"query": q, "variables": {"email": user, "password": password}}
        try:
            r = requests.post(url, headers=headers, json=body, timeout=10)
        except Exception:
            continue
        try:
            j = r.json()
        except Exception:
            j = None
        if j:
            # GraphQL pode retornar token em data.<mutation>
            t = None
            if "data" in j:
                t = find_token(j["data"]) or find_token(j)
            else:
                t = find_token(j)
            if t:
                return t, url, name

    return None, None, None


def main():
    base = os.getenv("SOFIT_BASE_URL", "https://sofitview.com.br")
    user = os.environ.get("SOFIT_USER", "integracaoinlog@ambiental.sc")
    pwd = os.environ.get("SOFIT_PASS", "1234567")

    if not user:
        user = input("Usuário / email: ")
    if not pwd:
        pwd = getpass.getpass("Senha: ")

    print(f"Tentando obter token para {user} em {base}...")

    t, url, kind = try_rest(base, user, pwd)
    if t:
        print("\nToken encontrado (REST):")
        print(t)
        print("\nExportar para PowerShell:")
        print(f'$env:SOFIT_TOKEN = "{t}"')
        return

    t, url, kind = try_graphql(base, user, pwd)
    if t:
        print("\nToken encontrado (GraphQL):")
        print(t)
        print("\nExportar para PowerShell:")
        print(f'$env:SOFIT_TOKEN = "{t}"')
        return

    print("\nNão foi possível obter token automaticamente.")
    print("Tente inspecionar as requisições no navegador (DevTools -> Network) ou forneça um token manualmente.")


if __name__ == '__main__':
    main()
