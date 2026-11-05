# Roadmap

Alpha now; these are next, roughly in order. Nothing here is a promise of dates.

- **Clients:** Go client; Spring Boot starter.
- **Gateways:** Kong and Apigee plugins; an NGINX `auth_request` recipe.
- **Stores:** Redis store for shared velocity and dedupe state across replicas.
- **Canaries:** more canary types (decoy API keys in config repos, decoy merchant IDs, honey intents in LOS exports).
- **Engine:** converge on one shared engine with [Krediwall](https://github.com/peopleofproduct/krediwall) (see [ADR 0001](docs/adr/0001-engine.md)).
- **Operations console:** an operations console is planned.
