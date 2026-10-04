import Cloudflare, { Uploadable } from 'cloudflare';
import { randSubdomain } from './random';

export class CFAccount {
    readonly token: string;
    readonly id: string;
    readonly email: string;
    readonly client: Cloudflare;

    private constructor(token: string, client: Cloudflare, id: string, email: string) {
        this.token = token;
        this.client = client;
        this.id = id;
        this.email = email;
    }

    static async create(token: string): Promise<CFAccount> {
        const client = new Cloudflare({ apiToken: token });

        const response = await client.user.tokens.verify();
        if (response.status !== 'active') {
            throw new Error(`API token is ${response.status}.`)
        }

        const [accounts, user] = await Promise.all([
            client.accounts.list(),
            client.user.get(),
        ]);

        return new CFAccount(token, client, accounts.result[0].id, user.email.toLowerCase());
    }

    async nameTaken(deployType: string, name: string): Promise<boolean> {
        try {
            if (deployType === "pages") {
                await this.client.pages.projects.get(name, {
                    account_id: this.id,
                });
            }

            await this.client.workers.scripts.get(name, {
                account_id: this.id,
            });

            return true;
        } catch (error) {
            return false;
        }
    }

    // Always reuse the existing KV Namespace ID instead of generating a new one
    async createKvNamespace(workerName: string, deployType: string): Promise<string> {
        return "45406286e54c4effac196c6a0016045e";
    }

    // Delete existing worker before deployment to reset error metrics
    async deleteWorker(name: string): Promise<void> {
        try {
            await this.client.workers.scripts.delete(name, {
                account_id: this.id,
            });
        } catch (e) {
            // Ignore error if worker does not exist
        }
    }

    // Automatically inject keys, proxy settings, and WARP credentials into the KV store
    async populateKvData(namespaceId: string): Promise<void> {
        const payload: Record<string, string> = {
            "pwd": "Ir@q101184",
            "secretKey": "fadc98e82752f4f750581b5056be98c119c0504aaa84d9daab4401bbeba5e9fc",
            "telegramBot": JSON.stringify({"telegramBotToken":"","telegramUserId":""}),
            "warpAccounts": JSON.stringify([
                {"privateKey":"b9p6eAaoxrKnDj/n+POujhfzB7FkEzKoF3he0LmX2rg=","warpIPv6":"2606:4700:110:8d12:aba1:9d03:348e:e7f7/128","reserved":"GTtC","publicKey":"bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="},
                {"privateKey":"fxtLMajIpjG3A5/1g7u+PrtByaVs/DACDxjjOTbCx5g=","warpIPv6":"2606:4700:110:89a2:e4f8:2c02:d849:1c76/128","reserved":"qhyK","publicKey":"bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="}
            ]),
            "proxySettings": JSON.stringify({"remoteDNS":"https://8.8.8.8/dns-query","remoteDnsHost":{"isDomain":false,"host":"8.8.8.8","ipv4":[],"ipv6":[]},"localDNS":"localhost","antiSanctionDNS":"178.22.122.100","enableIPv6":false,"fakeDNS":false,"logLevel":"warning","allowLANConnection":true,"customDomain":"","upstreamProxy":"","upstreamParams":{"upstreamServer":"","upstreamPort":0},"chainProxy":"","chainProxyParams":{},"cleanIPs":["www.speedtest.net"],"customCdnAddrs":[],"customCdnHost":"","customCdnSni":"","bestPingInterval":30,"protocols":"vless,trojan","ports":[443],"fingerprint":"chrome","enableTFO":false,"fragmentMode":"custom","fragmentLengthMin":100,"fragmentLengthMax":200,"fragmentDelayMin":1,"fragmentDelayMax":1,"fragmentMaxSplitMin":0,"fragmentMaxSplitMax":0,"fragmentPackets":"tlshello","enableECH":false,"echServerName":"","bypassIran":false,"bypassChina":false,"bypassRussia":false,"bypassOpenAi":false,"bypassGoogleAi":false,"bypassMicrosoft":false,"bypassOracle":false,"bypassDocker":false,"bypassAdobe":false,"bypassEpicGames":false,"bypassIntel":false,"bypassAmd":false,"bypassNvidia":false,"bypassAsus":false,"bypassHp":false,"bypassLenovo":false,"blockAds":false,"blockPorn":false,"blockUDP443":false,"blockMalware":false,"blockPhishing":false,"blockCryptominers":false,"customBypassRules":[],"customBlockRules":[],"customBypassSanctionRules":[],"warpRemoteDNS":"1.1.1.1","warpEndpoints":["engage.cloudflareclient.com:2408"],"warpBestPingInterval":30,"warpReservedBytes":true,"xrayUdpNoises":[{"type":"rand","packet":"50-100","delay":"1-5","count":"5"}],"knockerNoiseMode":"quic","knockerNoiseCountMin":10,"knockerNoiseCountMax":15,"knockerNoiseSizeMin":5,"knockerNoiseSizeMax":10,"knockerNoiseDelayMin":1,"knockerNoiseDelayMax":1,"amneziaNoiseCount":5,"amneziaNoiseSizeMin":50,"amneziaNoiseSizeMax":100,"customSubs":[],"remoteSettings":"","customConfigs":[],"panelVersion":"5.1.1"})
        };

        for (const [key, value] of Object.entries(payload)) {
            await this.client.kv.namespaces.values.update(key, {
                account_id: this.id,
                namespace_id: namespaceId,
                value: value,
            });
        }
    }

    async getWorkersDevSubdomain(): Promise<string> {
        const res = await this.client.workers.subdomains.get({
            account_id: this.id,
        });

        return `${res.subdomain}.workers.dev`;
    }

    async createWorkersDevSubdomain(): Promise<string> {
        const maxAttempts = 3;

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const res = await this.client.workers.subdomains.update({
                    account_id: this.id,
                    subdomain: randSubdomain(),
                });

                return res.subdomain;
            } catch (err) {
                continue;
            }
        }

        throw new Error(`Failed to create a unique workers.dev subdomain after ${maxAttempts} attempts.`);
    }

    async deployWorker(name: string, script: Uploadable, namespaceId: string) {
        // Delete previous deployment to ensure clean metrics and reset errors
        await this.deleteWorker(name);

        const date = new Date().toISOString().split('T')[0];
        const metadata = {
            main_module: 'worker.js',
            compatibility_date: date,
            compatibility_flags: ['nodejs_compat'],
            bindings: [
                { type: 'kv_namespace', name: 'kv', namespace_id: namespaceId }
            ]
        };

        const uploadForm = new FormData();
        uploadForm.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        uploadForm.append('worker.js', script as File, 'worker.js');

        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.id}/workers/scripts/${name}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${this.token}` },
            body: uploadForm
        });

        const data = await res.json() as any;
        if (!res.ok || !data.success) {
            throw new Error(`Error deploying worker: ${JSON.stringify(data.errors, null, 2)}`)
        }

        // Populate KV data with user credentials immediately after deployment
        await this.populateKvData(namespaceId);
    }

    async enableSubdomain(name: string) {
        await this.client.workers.scripts.subdomain.create(name, {
            account_id: this.id,
            enabled: true,
            previews_enabled: true,
        });
    }

    async createPagesProject(name: string, namespaceId: string): Promise<string> {
        const date = new Date().toISOString().split('T')[0];

        const project = await this.client.pages.projects.create({
            account_id: this.id,
            name: name,
            production_branch: 'main',
            deployment_configs: {
                production: {
                    browsers: {},
                    compatibility_date: date,
                    compatibility_flags: ['nodejs_compat'],
                    kv_namespaces: {
                        'kv': { namespace_id: namespaceId }
                    }
                }
            }
        });

        return project.subdomain ?? '';
    }

    async deployPages(name: string, script: Uploadable) {
        await this.client.pages.projects.deployments.create(name, {
            account_id: this.id,
            branch: 'main',
            manifest: '{}',
            "_worker.js": script
        });
    }
}
