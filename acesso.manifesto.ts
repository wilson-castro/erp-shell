import { definirManifesto } from '@erp/contratos'

export default definirManifesto({
  zona: 'shell',
  modulos: [{ id: 'shell.inicio', rotulo: 'Início', prefixo: '/', restritoPorPadrao: false }],
  perfis: [],
  concessoes: {},
})
