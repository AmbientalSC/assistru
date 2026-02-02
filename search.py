import os
import sys
import requests
from datetime import datetime, timedelta, timezone

# ================================
# CONFIGURAÇÕES
# ================================
# O token agora é lido da variável de ambiente `SOFIT_TOKEN`.
# Defina com PowerShell: $env:SOFIT_TOKEN = "seu_token_aqui"
TOKEN = os.getenv("SOFIT_TOKEN") 
URL_GRAPHQL = "https://sofitview.com.br/api/v2/graphql"
NOME_VEICULO = "VT7231"

# OBS: removemos a obtenção automática de token via login (try_rest/try_graphql)
# e passamos a usar um token hardcoded (ou `SOFIT_TOKEN` se definida no ambiente).
# ATENÇÃO: colocar token hardcoded é inseguro; prefer usar `SOFIT_TOKEN` via env var.
# Para ocultar o token do repositório, não comite esse arquivo com o token real.

# Configure seu token aqui (substitua pelo token real) ou defina a variável de ambiente:
TOKEN = os.getenv("SOFIT_TOKEN") or "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJ1dWlkIjoiODNlMGU5NzYtYTdmMy00MjgyLTljMWItNDExOGE5ZjJjZDM0IiwidXNlcl9lbWFpbCI6ImludGVncmFjYW9pbmxvZ0BhbWJpZW50YWwuc2MiLCJ1c2VyX25hbWUiOiJpbnRlZ3JhY2FvaW5sb2dAYW1iaWVudGFsLnNjIiwidXNlcl9pZCI6MzQyMjY4LCJjbGllbnRfaWQiOjE4NjAsImlwIjoiMTc3LjM0Ljc3LjIyNiIsImNyZWF0ZWRfYXQiOiIyMDI2LTAxLTI5VDE2OjE3OjM2LjQwMVoiLCJleHBpcmVzIjp0cnVlLCJ0b2tlbiI6bnVsbCwiaW1wb3J0VG9WMiI6ZmFsc2UsImlzQWRtaW4iOnRydWUsImlzU3VwcG9ydCI6ZmFsc2UsImlhdCI6MTc2OTcwMzQ1NiwiZXhwIjoxNzY5NzMyMjU2fQ.bemP_7FR5ZTT9yxiGNMbyg9rXCmI3mC-6J3HZgUbm1M4swBwhEsv7lRpzFvYaxniMJFgRKBnuU45lhO_KxqkO8MIMcJrVuruWHywDcKGaRTQlX90g_1wcACXRxinmYbbukN0b_gnkp6jg6hjBWZtSgP7V-8ParqmjyDWaju8XeHFNYeKd2-odb6ljqysfd1oVFKNWvBVTeA5MAPGgufsg6c6FPpDvvDcMc7ztZ-qehX-SEW3JO7K61WK2nXQPJF9Lg0FxqI2p-GbVcy2qvzVZQ9005_o3OSKjAWzp7DjJIfC2KBIWgzLDWeNgD9geP_2rgz9DTi4mMXksXN1yAK-6Q4DBHrt3ZQ8Czfg8l_wh6hXC7S7r6hB-NAhc0dnL4RyCAWQcdJ-qvOBosIT7e8Ep5YsdVcSGevV6VJNhC4iZEQdlMRyVW27PXn8xYvCsjVCH8zjbvlJkQED6jHzGtXr_EX1YzE9nvlwt7TV7YtGwlyl_DB80BTAWqk2UmQ0wzUj"


# Sempre tentar obter token via credenciais a cada execução. Se não houver
# credenciais configuradas, usamos o SOFIT_TOKEN do ambiente como fallback.
if not TOKEN or TOKEN == "COLE_SEU_TOKEN_AQUI":
  print("Token não encontrado. Defina `TOKEN` no arquivo ou via variável de ambiente `SOFIT_TOKEN`.")
  print("Exemplo PowerShell: $env:SOFIT_TOKEN='seu_token_aqui'; python .\\search.py")
  sys.exit(1)
else:
  # Mensagem informativa (não indica se token veio do env ou do hardcode)
  if os.getenv("SOFIT_TOKEN"):
    print("Usando token da variável de ambiente SOFIT_TOKEN.")
  else:
    print("Usando token hardcoded no arquivo.")

# ================================
# HEADERS DA REQUISIÇÃO
# ================================
headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

# ================================
# 1) BUSCAR O ID DO VEÍCULO PELO NOME
# ================================
# Consulta veículos em páginas e filtra localmente pelo nome, pois o campo
# `search` pode não ser aceito pelo schema GraphQL do Sofit.
def find_vehicle_id_by_name(name, per_page=20, max_pages=100):
  query = """
  query ($page:Int!, $perPage:Int!) {
    vehicles(page: $page, perPage: $perPage) {
    nodes { id name }
    }
  }
  """

  name_lower = name.lower()
  for page in range(1, max_pages + 1):
    vars = {"page": page, "perPage": per_page}
    try:
      resp = requests.post(URL_GRAPHQL, headers=headers, json={"query": query, "variables": vars}, timeout=10)
      resp.raise_for_status()
    except requests.exceptions.RequestException as e:
      print(f"Erro na requisição na página {page}: {e}")
      continue
    try:
      j = resp.json()
    except Exception:
      print(f"Erro ao decodificar resposta JSON na página {page} (status {resp.status_code}).")
      continue

    if "errors" in j:
      print("Erro ao buscar veículos (GraphQL):", j["errors"])
      return None, None

    nodes = j.get("data", {}).get("vehicles", {}).get("nodes", [])
    if not nodes:
      # sem mais resultados
      break

    # filtrar localmente por nome (contains, case-insensitive)
    for v in nodes:
      if v.get("name") and name_lower in v.get("name").lower():
        return v.get("id"), v.get("name")

  return None, None


veiculo_id, veiculo_name = find_vehicle_id_by_name(NOME_VEICULO, per_page=20, max_pages=100)

if not veiculo_id:
  print(f"Nenhum veículo encontrado com esse nome: '{NOME_VEICULO}'.")
  sys.exit(1)

print(f"Veículo encontrado: {veiculo_name} (ID {veiculo_id})")

# ================================
# 2) CALCULAR PERÍODO DE 2 MESES
# ================================
data_filtro = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%dT00:00:00Z")

# ================================
# 3) BUSCAR ORDENS DE SERVIÇO
# ================================
query_os = """
query ($dateFilter: DateTime!, $search: String) {
  serviceOrders(
    page: 1,
    perPage: 20,
    lastIntegrationDate: $dateFilter,
    search: $search
  ) {
    nodes {
      id
      name
      status
      created_at
      vehicle { id name }
      total_cost
      problem_description
      supplier { id name }
      employee { id name }
      foreseen_service_order_items {
        id
        name
        foreseen_quantity
        item { id name }
      }
    }
    count
  }
}
"""

# Usamos `NOME_VEICULO` como string de busca (full-text) para o argumento `search`.
variables_os = {"dateFilter": data_filtro, "search": NOME_VEICULO}

try:
  resp_os = requests.post(
    URL_GRAPHQL,
    headers=headers,
    json={"query": query_os, "variables": variables_os},
    timeout=10,
  )
  resp_os.raise_for_status()
except requests.exceptions.RequestException as e:
  print(f"Erro na requisição de ordens de serviço: {e}")
  sys.exit(1)

try:
  dados_os = resp_os.json()
except ValueError:
  print("Resposta das ordens de serviço não é JSON.")
  sys.exit(1)

if "errors" in dados_os:
  print("Erro ao buscar ordens de serviço:", dados_os["errors"])
  sys.exit(1)

# Filtrar OS pelo ID do veículo
service_orders = [
  so for so in dados_os["data"]["serviceOrders"]["nodes"]
  if so["vehicle"] and so["vehicle"]["id"] == veiculo_id
]

# ================================
# 4) EXIBIR RESULTADOS
# ================================
print("\nOrdens de Serviço encontradas:")
print("---------------------------------")

for so in service_orders:
  # Formatar data de criação para DD/mm/AAAA hh:MM:ss
  created_raw = so.get('created_at')
  created_str = created_raw
  if created_raw:
    try:
      created_dt = datetime.fromisoformat(created_raw.replace('Z', '+00:00'))
      created_str = created_dt.strftime('%d/%m/%Y %H:%M:%S')
    except Exception:
      # manter o valor bruto se não for possível parsear
      created_str = created_raw

  # Formatar custo como moeda brasileira: R$ 0,00
  cost_raw = so.get('total_cost')
  try:
    cost_val = float(cost_raw) if cost_raw is not None else 0.0
  except Exception:
    cost_val = 0.0
  # formata com separador de milhares '.' e decimal ','
  cost_formatted = f"{cost_val:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
  cost_str = f"R$ {cost_formatted}"

  # Fornecedor e funcionário: preferir nome quando objeto
  supplier = so.get('supplier')
  if isinstance(supplier, dict):
    supplier_str = supplier.get('name') or 'N/A'
  else:
    supplier_str = supplier or 'N/A'

  employee = so.get('employee')
  if isinstance(employee, dict):
    employee_str = employee.get('name') or 'N/A'
  else:
    employee_str = employee or 'N/A'

  print(f"ID: {so['id']}")
  print(f"Nome: {so['name']}")
  print(f"Status: {so['status']}")
  print(f"Data criação: {created_str}")
  print(f"Veículo: {so['vehicle']['name']}")
  print(f"Custo total: {cost_str}")
  print(f"Descrição do problema: {so.get('problem_description', 'N/A')}")
  print(f"Fornecedor: {supplier_str}")
  print(f"Funcionário: {employee_str}")
  # Imprimir itens previstos (foreseen_service_order_items)
  foreseen_items = so.get('foreseen_service_order_items') or []
  if foreseen_items:
    print("Itens previstos:")
    for it in foreseen_items:
      # nome do item pode estar em it['name'] ou em it['item']['name']
      item_name = None
      if isinstance(it, dict):
        item_name = it.get('name') or (it.get('item') or {}).get('name')
        qty = it.get('foreseen_quantity') if 'foreseen_quantity' in it else it.get('foreseenQuantity')
      else:
        item_name = str(it)
        qty = None
      qty_str = str(qty) if qty is not None else 'N/A'
      print(f"  - {item_name or 'N/A'} (qtd: {qty_str})")
  else:
    print("Itens previstos: N/A")
  print("---------------------------------")

print(f"Total encontradas: {len(service_orders)}")
