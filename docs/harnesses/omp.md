# OMP harness

[OMP](https://omp.sh/docs) can use Manifest as a native OpenAI-compatible provider. The setup uses OMP's model discovery, so Manifest Auto and the model IDs you explicitly advertise appear without copying a static provider catalog.

Add this provider to `~/.omp/agent/models.yml`:

```yaml
providers:
  manifest:
    baseUrl: 'https://app.manifest.build/v1'
    apiKey: 'mnfst_YOUR_KEY'
    api: openai-responses
    authHeader: true
    discovery:
      type: openai-models-list
```

For a self-hosted install, replace `baseUrl` with the same origin as the dashboard plus `/v1`, for example `http://localhost:2099/v1`.

Then start OMP with Manifest's automatic route:

```bash
omp --model manifest/auto
```

OMP authenticates `GET /v1/models` and `POST /v1/responses` with the harness key, discovers `auto`, `manifest/auto`, and enabled catalog aliases, and sends tool-calling requests through Manifest's routing pipeline. Raw connected-provider catalogs stay private until you add a model to the harness catalog. The explicit `--model` selection leaves your other OMP model roles unchanged.

Manifest deliberately keeps provider availability separate from harness visibility:

- **Routing model availability** controls which connected-provider models Manifest may choose.
- **Harness model catalog** controls which additional model IDs appear in OMP and other model pickers.

Add a provider model to the harness catalog once. When the provider reports supported reasoning efforts, the generated OMP setup adds a `modelOverrides` entry so OMP renders one model with its reasoning selector. Manifest maps the selected effort to the attempted provider's parameter shape, including Responses API `reasoning.effort`, Chat Completions `reasoning_effort`, and provider-specific nested parameters.

Create a fixed reasoning alias only when a workflow needs a separate ID that always pins one effort. Manifest no longer generates every effort as a separate model by default.

Run `omp models find manifest` to confirm discovery if the model is not selectable. Check that the key and endpoint are current and that `manifest` is not listed in OMP's `disabledProviders` setting.
