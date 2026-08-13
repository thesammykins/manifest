# OMP harness

[OMP](https://omp.sh/docs) can use Manifest as a native OpenAI-compatible provider. The setup uses OMP's model discovery, so new Manifest routes and enabled aliases appear without copying a new static model list.

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

OMP authenticates `GET /v1/models` and `POST /v1/responses` with the harness key, discovers `auto`, `manifest/auto`, enabled aliases, and available direct models, and sends tool-calling requests through Manifest's routing pipeline. The explicit `--model` selection leaves your other OMP model roles unchanged.

Run `omp models find manifest` to confirm discovery if the model is not selectable. Check that the key and endpoint are current and that `manifest` is not listed in OMP's `disabledProviders` setting.
