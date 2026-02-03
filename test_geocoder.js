const ToolService = require('./electron/providers/ToolService');

// Mock Store
const mockStore = {
    get: (key, defaultValue) => defaultValue
};

const toolService = new ToolService(mockStore);

async function testGeocoder() {
    console.log('--- Testando Geocoder (ToolService) ---');
    const endereco = "Rua XV de Novembro, 123, Joinville, SC";

    try {
        console.log(`Buscando coleta para: "${endereco}"...`);
        const result = await toolService.buscarColeta({ endereco });

        console.log('\n--- Resultado ---');
        console.log('Encontrado:', result.found);
        console.log('Endereço Resolvido:', result.resolved_address);
        console.log('Coordenadas:', result.coordinates);
        console.log('Dados da Coleta (AWS):', JSON.stringify(result.raw_result, null, 2));

        if (result.coordinates && result.coordinates.lat && result.coordinates.lon) {
            console.log('\n✅ Geocoder funcionou corretamente!');
        } else {
            console.log('\n❌ Geocoder falhou (sem coordenadas).');
        }

    } catch (error) {
        console.error('\n❌ Erro durante o teste:', error.message);
    }
}

testGeocoder();
