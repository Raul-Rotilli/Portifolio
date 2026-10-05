/* =========================================================================
   raulgpt.js — RaulGPT: um mini-RAG que roda 100% no navegador (#raulgpt-root)
   Pipeline: normalização (minúsculas, sem acentos) → tokens → stopwords →
   radicais (stemming leve) → correção de digitação + sinônimos → vetor TF-IDF
   → similaridade de cosseno com cada trecho da base → top-3.
   Não há LLM: a resposta é o texto do trecho vencedor, exibido token a token.
   O núcleo (sem DOM) fica em RR.raulgpt para testes e para outros módulos.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR) return;

  var GITHUB = 'https://github.com/Raul-Rotilli';
  var LINKEDIN = 'https://www.linkedin.com/in/raul-rotilli-aguirre/';
  var INSTAGRAM = 'https://www.instagram.com/raulrotilli/';

  var THRESHOLD = 0.15;   // cosseno mínimo para responder; abaixo disso, fallback honesto
  var RELATED_MIN = 0.6;  // o 2º trecho vira "Relacionado" se tiver ≥ 60% do score do 1º
  var W_WEAK = 0.35;      // peso de palavras fracas ("você", "onde", "quem"…)
  var W_FIX = 0.85;       // peso de um termo corrigido por distância de edição
  var W_SYN = 0.5;        // peso de um sinônimo adicionado à consulta
  var W_SYN_OOV = 0.9;    // peso do sinônimo quando a palavra original não está no vocabulário

  /* =====================================================================
     1. BASE DE CONHECIMENTO
     text/title/tags são indexados; answer é o que o RaulGPT responde.
     Respostas: [rótulo](url) vira link; {n} vira o nº de trechos da base.
     ===================================================================== */
  var KB = [
    {
      id: 'sobre', title: 'Quem é o Raul', q: 'Quem é você?',
      tags: 'quem raul rotilli aguirre nome apresentacao apresente perfil desenvolvedor dev programador',
      text: 'Raul Rotilli Aguirre, desenvolvedor em formação apaixonado por programação, com base em back-end e foco atual em IA.',
      answer: 'Sou o Raul Rotilli Aguirre — ou melhor, a versão dele feita de vetores TF-IDF. Sou desenvolvedor em formação e apaixonado por programação: comecei pelo back-end, com Java e Spring, e hoje direciono meus estudos para Inteligência Artificial e Machine Learning.'
    },
    {
      id: 'formacao', title: 'Formação: Técnico em Informática', q: 'Qual é a sua formação?',
      tags: 'formacao formado curso tecnico informatica senac tech escola onde estudou 2020 2023 diploma',
      text: 'Curso Técnico em Informática no Senac Tech, de 2020 a 2023. Foi o curso que o despertou para o mundo da TI.',
      answer: 'Fiz o Curso Técnico em Informática no Senac Tech, de 2020 a 2023. Foi ele que me despertou para o mundo da TI — e, desde então, estou determinado a me tornar um grande desenvolvedor de software.',
      action: { label: 'Ver a trajetória', href: '#trajetoria' }
    },
    {
      id: 'experiencia', title: 'Experiência profissional', q: 'Onde você já trabalhou?',
      tags: 'onde trabalhou trabalho trabalhos experiencia experiencias profissional emprego empregos estagio estagios estagiario carreira empresas',
      text: 'Experiência profissional: dois estágios de TI.',
      answer: 'Fui estagiário de TI em dois lugares: na Metha Informática Ltda, com manutenção de hardware e software, e na Secretaria Municipal de Cultura de Porto Alegre, onde administrava o setor de informática local. Quer detalhes de algum deles?',
      action: { label: 'Ver a trajetória', href: '#trajetoria' }
    },
    {
      id: 'metha', title: 'Estágio na Metha Informática', q: 'O que você fazia na Metha?',
      tags: 'metha informatica ltda estagio estagiario trabalhou hardware software manutencao manutencoes suporte',
      text: 'Estagiário de TI na Metha Informática Ltda, com manutenções de hardware e software.',
      answer: 'Na Metha Informática Ltda fui estagiário de TI e cuidava de manutenções de hardware e software — TI raiz, de abrir a máquina e resolver o problema de verdade.'
    },
    {
      id: 'secretaria', title: 'Estágio na Secretaria de Cultura', q: 'O que você fazia na Secretaria de Cultura?',
      tags: 'secretaria municipal cultura porto alegre prefeitura publico estagio estagiario trabalhou ordens servico administracao setor',
      text: 'Estagiário de TI na Secretaria Municipal de Cultura de Porto Alegre: administrava o setor de informática local, abria ordens de serviço de manutenção de hardware e software e realizava as manutenções.',
      answer: 'Na Secretaria Municipal de Cultura de Porto Alegre, como estagiário de TI, eu administrava o setor de informática local: abria ordens de serviço de manutenção de hardware e software e eu mesmo realizava as manutenções.'
    },
    {
      id: 'novageracao', title: 'Nova Geração · Instituto Caldeira', q: 'O que foi o Nova Geração?',
      tags: 'nova geracao instituto caldeira programa 2023 networking soft skills divisor aguas virada tres meses bootcamp',
      text: 'Programa Nova Geração do Instituto Caldeira, em 2023: três meses de networking, treinamento de soft skills e formação em programação pela Alura. Um divisor de águas.',
      answer: 'O Nova Geração, do Instituto Caldeira, foi um divisor de águas pra mim. Em 2023, foram três meses de networking, treinamento de soft skills e formação em programação pela Alura. Ali redescobri minha paixão pela programação, convivendo com pessoas incríveis e talentosas.',
      action: { label: 'Ver a trajetória', href: '#trajetoria' }
    },
    {
      id: 'alura', title: 'Cursos na Alura', q: 'Quais cursos você fez na Alura?',
      tags: 'alura cursos curso certificados certificado trilha programacao comunicacao assertiva conflitos frustracoes online 2023',
      text: 'Na Alura, em 2023: Trilha de programação do Instituto Caldeira e o curso Comunicação assertiva: reduzindo conflitos e frustrações.',
      answer: 'Na Alura, em 2023, fiz a Trilha de programação do Instituto Caldeira e o curso “Comunicação assertiva: reduzindo conflitos e frustrações”. Afinal, código bom também depende de conversa boa.'
    },
    {
      id: 'softskills', title: 'Soft skills', q: 'Quais são suas soft skills?',
      tags: 'soft skills comportamental comunicacao assertiva networking pessoas equipe convivencia relacionamento',
      text: 'Treinamento de soft skills e networking no Nova Geração; curso de comunicação assertiva na Alura.',
      answer: 'No Nova Geração tive treinamento de soft skills e muito networking, e na Alura fiz o curso “Comunicação assertiva: reduzindo conflitos e frustrações”. Conviver com pessoas incríveis e talentosas me fez crescer em todos os aspectos da vida — não só no código.'
    },
    {
      id: 'stack', title: 'Stack atual', q: 'Quais tecnologias você usa?',
      tags: 'stack tecnologias tecnologia linguagens linguagem ferramentas habilidades java spring springboot html css javascript js backend frontend web',
      text: 'Back-end com Java e Spring; web com HTML, CSS e JavaScript.',
      answer: 'Minha stack atual é Java e Spring no back-end, e HTML, CSS e JavaScript na web. Este site, aliás, é todo feito com HTML, CSS e JavaScript puros. Já Python, ML e LLMs estão na parte “em treinamento”.'
    },
    {
      id: 'ia', title: 'Foco em IA & Machine Learning', q: 'O que você estuda?',
      tags: 'estuda estudos aprendendo foco ia inteligencia artificial machine learning ml aprendizado maquina python redes neurais llm llms treinamento atualmente hoje',
      text: 'Estudos atuais em Inteligência Artificial e Machine Learning: Python, ML, redes neurais e LLMs. Estudo em andamento, não experiência profissional.',
      answer: 'Hoje meu foco de estudo é Inteligência Artificial e Machine Learning: Python, ML, redes neurais e LLMs. É aprendizado em andamento, não experiência profissional — por isso o selo “em treinamento” no meu model card.'
    },
    {
      id: 'motivo', title: 'Por que IA?', q: 'Por que você escolheu IA?',
      tags: 'motivo motivacao escolheu escolha interesse paixao mudanca transicao dados',
      text: 'O que move a mudança para IA: dados, modelos que aprendem e produtos inteligentes que resolvem problemas.',
      answer: 'Porque quero construir software que aprende: dados, modelos que aprendem e produtos inteligentes que resolvem problemas reais. Comecei pelo back-end, e essa base é justamente o que ajuda a levar um modelo do notebook para a produção.'
    },
    {
      id: 'objetivos', title: 'Objetivos', q: 'Quais são seus objetivos?',
      tags: 'objetivo objetivos meta metas sonho futuro plano planos carreira pretende producao deploy grande',
      text: 'Tornar-se um grande desenvolvedor de software e levar modelos de IA para a produção.',
      answer: 'Quero me tornar um grande desenvolvedor de software — e unir minha base de back-end com IA para levar modelos do notebook para a produção. Enquanto isso, sigo treinando: a perda só cai.'
    },
    {
      id: 'contato', title: 'Contato', q: 'Como falo com você?',
      tags: 'contato contatar falar conversar chamar mensagem linkedin github instagram sociais email telefone whatsapp contratar recrutador vaga oportunidade',
      text: 'Contato pelo LinkedIn, GitHub e Instagram.',
      answer: 'O melhor caminho é o [LinkedIn](' + LINKEDIN + '). Também estou no [GitHub](' + GITHUB + ') e no [Instagram](' + INSTAGRAM + '). Estou aberto a oportunidades, projetos e boas conversas — vamos treinar algo juntos?',
      action: { label: 'Ir para Contato', href: '#contato' }
    },
    {
      id: 'projetos', title: 'Projetos e GitHub', q: 'Onde vejo seus projetos?',
      tags: 'projetos projeto repositorios repositorio codigo fonte github portfolio',
      text: 'Repositórios no GitHub; este site também é um projeto, escrito em JavaScript puro.',
      answer: 'Meus repositórios estão no [GitHub](' + GITHUB + '). E este próprio site é um projeto: galeria neural, rede neural treinando ao vivo e este mini-RAG, tudo em JavaScript puro, sem bibliotecas.'
    },
    {
      id: 'site', title: 'Como este site foi feito', q: 'Como este site foi feito?',
      tags: 'site pagina portfolio feito construido construiu desenvolvido html css javascript puro puros framework bibliotecas navegador',
      text: 'Feito com HTML, CSS e JavaScript puros, sem frameworks; artes geradas por algoritmos no navegador; foto com fundo removido pela IS-Net; paleta extraída com k-means; RaulGPT com TF-IDF e cosseno.',
      answer: 'Com HTML, CSS e JavaScript puros — sem frameworks nem bibliotecas. As artes são geradas por algoritmos, ao vivo, no seu navegador; a foto teve o fundo removido pela rede de segmentação IS-Net; e a paleta de cores saiu da própria foto com k-means. Eu, no caso, sou TF-IDF + similaridade de cosseno.'
    },
    {
      id: 'galeria', title: 'Galeria neural', q: 'O que tem na galeria?',
      tags: 'galeria neural obras obra arte artes retratos retrato oito 8 algoritmos generativa parametros baixar',
      text: 'Oito retratos gerados ao vivo a partir da foto, cada um por um algoritmo clássico de IA, visão computacional ou álgebra linear.',
      answer: 'A galeria neural tem oito retratos gerados ao vivo a partir da minha foto: K-Means, convolução, SVD, tokenização, Delaunay, pontilhismo de Voronoi, campo de gradientes e quantização com Floyd–Steinberg. Dá para mexer nos parâmetros, comparar com o original e baixar a sua favorita.',
      action: { label: 'Ir para a galeria', href: '#galeria' }
    },
    {
      id: 'isnet', title: 'Remoção de fundo com IS-Net', q: 'Como o fundo da foto foi removido?',
      tags: 'fundo remocao removido remover segmentacao isnet mascara recorte transparente foto background',
      text: 'A foto teve o fundo removido pela IS-Net, uma rede neural de segmentação que separa pessoa e fundo pixel a pixel.',
      answer: 'O fundo da minha foto foi removido pela IS-Net, uma rede neural de segmentação: ela estima, pixel a pixel, o que é pessoa e o que é fundo, gerando uma máscara de recorte. Por isso o retrato tem fundo transparente e as artes da galeria podem brincar com ele.'
    },
    {
      id: 'paleta', title: 'Paleta de cores da foto', q: 'De onde vieram as cores do site?',
      tags: 'cores cor paleta tema design azul menta verde visual',
      text: 'Paleta de cores extraída da foto com k-means (k = 4); verde-menta herdado do portfólio antigo.',
      answer: 'A paleta saiu da minha própria foto com k-means: os pixels foram agrupados em k = 4 clusters e os centróides viraram cores — o azul da camiseta, os tons de pele ao sol e a sombra. O verde-menta veio do meu portfólio antigo.',
      action: { label: 'Ver o K-Means na galeria', gallery: 'kmeans' }
    },
    {
      id: 'difusao', title: 'Modelos de difusão', q: 'O que é um modelo de difusão?',
      tags: 'difusao diffusion ruido denoising gerativo generativo stable particulas hero topo gerar imagens',
      text: 'Modelos de difusão aprendem a remover ruído passo a passo; o retrato do topo do site imita esse processo com partículas.',
      answer: 'Modelos de difusão aprendem a remover ruído: no treino, a imagem é destruída aos poucos com ruído e a rede aprende o caminho de volta. Para gerar, partem de ruído puro e o limpam passo a passo. O retrato no topo da página imita esse processo com partículas.',
      action: { label: 'Refazer a difusão do retrato', href: '#inicio', emit: 'hero:renoise' }
    },
    {
      id: 'kmeans', title: 'K-Means', q: 'Como funciona o k-means?',
      tags: 'kmeans k means clustering agrupamento agrupar clusters centroide centroides supervisionado pop art',
      text: 'K-Means agrupa dados em k clusters sem rótulos: cada ponto vai para o centróide mais próximo e cada centróide vai para a média do grupo. Aprendizado não supervisionado.',
      answer: 'O K-Means agrupa dados em k clusters sem nenhum rótulo: cada ponto vai para o centróide mais próximo e cada centróide se move para a média do seu grupo, repetindo até estabilizar. É aprendizado não supervisionado — na galeria, ele reduz minha foto a k cores e vira pop art.',
      action: { label: 'Ver o K-Means na galeria', gallery: 'kmeans' }
    },
    {
      id: 'convolucao', title: 'Convolução e CNNs', q: 'O que é uma convolução?',
      tags: 'convolucao convolucoes convolucional cnn cnns kernel kernels filtro filtros bordas visao computacional features mapa',
      text: 'Um kernel desliza sobre a imagem e cada pixel vira a soma ponderada dos vizinhos; CNNs aprendem esses filtros para detectar bordas e texturas.',
      answer: 'Uma convolução desliza um pequeno kernel (um 3×3, por exemplo) sobre a imagem, e cada pixel vira a soma ponderada dos vizinhos — é assim que se detectam bordas e texturas. As CNNs aprendem esses filtros sozinhas durante o treino; no “Mapa de features” da galeria, eles foram escolhidos à mão.',
      action: { label: 'Ver a convolução na galeria', gallery: 'convolution' }
    },
    {
      id: 'svd', title: 'SVD, posto baixo e LoRA', q: 'O que é SVD? E o LoRA?',
      tags: 'svd valores singulares decomposicao posto baixo low rank lora pca compressao matriz matrizes algebra linear fine tuning ajuste fino',
      text: 'A SVD decompõe uma matriz em camadas ordenadas por importância; a aproximação de posto baixo guarda o essencial com menos números. Base do PCA, de compressão e do LoRA.',
      answer: 'A SVD decompõe uma matriz em A = U Σ Vᵀ, camadas ordenadas por importância; somando só as k primeiras, você tem a melhor aproximação de posto k. É a ideia por trás do PCA, da compressão de dados e do LoRA, que ajusta LLMs treinando só matrizes de posto baixo.',
      action: { label: 'Ver a SVD na galeria', gallery: 'svd' }
    },
    {
      id: 'tokenizacao', title: 'Tokenização', q: 'O que é tokenização?',
      tags: 'tokenizacao tokenizar tokenizador token tokens bpe subpalavras vocabulario texto ascii caracteres pln nlp',
      text: 'Tokenizar é quebrar texto em pedaços e transformá-los em números; LLMs usam tokenizadores como BPE. O retrato tokenizado faz o caminho inverso com caracteres.',
      answer: 'Tokenizar é quebrar o texto em pedaços — palavras, subpalavras ou caracteres — e trocar cada um por um número que o modelo entende; LLMs usam tokenizadores como o BPE. No “Retrato tokenizado” da galeria, o caminho é o inverso: cada região da foto vira um caractere. E sim, eu também tokenizei a sua pergunta (olhe no inspetor).',
      action: { label: 'Ver o retrato tokenizado', gallery: 'ascii' }
    },
    {
      id: 'delaunay', title: 'Triangulação de Delaunay', q: 'O que é a triangulação de Delaunay?',
      tags: 'delaunay triangulacao triangulos triangulo low poly lowpoly malha poligonos geometria computacional',
      text: 'A triangulação de Delaunay liga pontos em triângulos maximizando o menor ângulo; o retrato vira low-poly.',
      answer: 'A triangulação de Delaunay liga pontos em triângulos maximizando o menor ângulo de cada um, evitando triângulos finos demais. Na galeria, há mais pontos onde a foto tem mais detalhe (olhos, cabelo, fones) e cada triângulo recebe a cor média dos pixels que cobre: o retrato vira low-poly.',
      action: { label: 'Ver o low-poly na galeria', gallery: 'delaunay' }
    },
    {
      id: 'voronoi', title: 'Lloyd e Voronoi', q: 'O que é o algoritmo de Lloyd?',
      tags: 'lloyd voronoi diagrama pontilhismo stipple stippling pontos celulas relaxamento centro massa',
      text: 'No algoritmo de Lloyd, cada pixel vai para o ponto mais próximo, formando um diagrama de Voronoi, e cada ponto vai para o centro de massa da sua célula: k-means no espaço da imagem.',
      answer: 'No algoritmo de Lloyd, cada pixel vai para o ponto mais próximo — formando um diagrama de Voronoi — e cada ponto se move para o centro de massa da sua célula. É literalmente o k-means no espaço da imagem, e é ele que acomoda os milhares de pontos do pontilhismo da galeria.',
      action: { label: 'Ver o pontilhismo na galeria', gallery: 'stipple' }
    },
    {
      id: 'gradientes', title: 'Gradientes e backpropagation', q: 'O que é backpropagation?',
      tags: 'gradiente gradientes backpropagation backprop retropropagacao descida derivada derivadas perda loss sobel campo vetorial pesos',
      text: 'O gradiente aponta a direção de maior subida; a retropropagação calcula o gradiente da perda em relação a cada peso e a descida do gradiente segue no sentido oposto.',
      answer: 'O gradiente aponta para onde uma função cresce mais rápido. A retropropagação (backprop) calcula o gradiente da perda em relação a cada peso da rede, e a descida do gradiente dá passos no sentido oposto, morro abaixo. Na galeria, a “Pintura por gradientes” usa o gradiente de brilho da foto para guiar as pinceladas.',
      action: { label: 'Ver a pintura por gradientes', gallery: 'flowfield' }
    },
    {
      id: 'quantizacao', title: 'Quantização e dithering', q: 'O que é quantização?',
      tags: 'quantizacao quantizar quantizado dithering floyd steinberg bits bit int8 int4 erro compressao memoria',
      text: 'Quantizar é representar valores com menos bits; o dithering de Floyd–Steinberg espalha o erro para os vizinhos. Em IA, pesos em int8 ou int4.',
      answer: 'Quantizar é representar valores com menos bits. O dithering de Floyd–Steinberg reduz a foto a poucos tons e empurra o erro de cada arredondamento para os vizinhos, então os tons continuam certos na média. Em IA é parecido: pesos em int8 ou int4 ocupam bem menos memória e preservam boa parte da qualidade.',
      action: { label: 'Ver a quantização na galeria', gallery: 'dither' }
    },
    {
      id: 'mlp', title: 'Rede neural no playground', q: 'Como funciona o playground de rede neural?',
      tags: 'playground rede neural redes neurais mlp perceptron camadas camada neuronios ativacao fronteira decisao forward lab xor espiral dataset treinar',
      text: 'No Lab, uma rede neural MLP escrita do zero em JavaScript treina ao vivo: forward pass, backpropagation e descida do gradiente, sem bibliotecas.',
      answer: 'No Lab, uma rede neural MLP escrita do zero em JavaScript treina ao vivo: forward pass, backpropagation e descida do gradiente, sem bibliotecas. Escolha um dataset (círculo, XOR, espiral…), ajuste as camadas e veja a fronteira de decisão se formar.',
      action: { label: 'Abrir o playground', href: '#lab' }
    },
    {
      id: 'otimizadores', title: 'Otimizadores: SGD, Momentum, RMSProp e Adam', q: 'Qual a diferença entre SGD e Adam?',
      tags: 'otimizador otimizadores otimizacao sgd adam momentum rmsprop taxa aprendizado learning rate corrida superficie rosenbrock diferenca',
      text: 'SGD, Momentum, RMSProp e Adam descem a mesma superfície de perda na corrida de otimizadores.',
      answer: 'O SGD dá passos na direção oposta ao gradiente; o Momentum acumula velocidade para atravessar vales; o RMSProp adapta o passo de cada parâmetro; e o Adam junta as duas ideias. Na “Corrida de otimizadores” do Lab, os quatro descem a mesma superfície de perda, lado a lado.',
      action: { label: 'Ver a corrida de otimizadores', href: '#optimizers-root' }
    },
    {
      id: 'overfitting', title: 'Overfitting e generalização', q: 'O que é overfitting?',
      tags: 'overfitting overfit sobreajuste generalizacao generalizar decorar decorou treino teste validacao regularizacao underfitting',
      text: 'Overfitting é quando o modelo decora os dados de treino em vez de aprender o padrão e erra em dados novos; a loss de teste denuncia.',
      answer: 'Overfitting é quando o modelo decora os dados de treino em vez de aprender o padrão: vai muito bem no treino e mal em dados novos. Por isso se separa um conjunto de teste. No playground do Lab, fique de olho nas duas curvas: se a loss de treino cai e a de teste sobe, a rede está decorando.',
      action: { label: 'Abrir o playground', href: '#lab' }
    },
    {
      id: 'rag', title: 'RAG (Retrieval-Augmented Generation)', q: 'O que é RAG?',
      tags: 'rag retrieval augmented generation recuperacao busca buscar base conhecimento trechos chatbot raulgpt funciona assistente',
      text: 'RAG recupera os trechos mais relevantes de uma base de conhecimento e os usa para responder. O RaulGPT é um RAG mínimo.',
      answer: 'RAG (Retrieval-Augmented Generation) é buscar os trechos mais relevantes de uma base de conhecimento e usá-los para responder. Eu sou a versão mínima disso: sua pergunta vira um vetor, comparo com os {n} trechos da minha base e respondo com o mais parecido. Num RAG completo, esses trechos iriam para um LLM redigir a resposta.'
    },
    {
      id: 'tfidf', title: 'TF-IDF e similaridade de cosseno', q: 'Como funciona o TF-IDF?',
      tags: 'tfidf tf idf frequencia termo inversa documento cosseno similaridade vetor vetores esparso stopwords stemming radical normalizacao ranking',
      text: 'TF-IDF pesa termos frequentes no trecho e raros na base; a similaridade de cosseno compara o vetor da pergunta com o de cada trecho.',
      answer: 'O TF-IDF dá peso alto a termos frequentes num trecho, mas raros na base inteira. Eu normalizo a sua pergunta (minúsculas, sem acentos, sem stopwords, só os radicais), monto o vetor e calculo o cosseno do ângulo com cada trecho: 1 é idêntico, 0 é nada a ver. O inspetor mostra tudo isso ao vivo.'
    },
    {
      id: 'embeddings', title: 'Embeddings', q: 'O que são embeddings?',
      tags: 'embedding embeddings espaco vetorial vetores densos semantica significado vizinhos proximos word2vec mapa',
      text: 'Embeddings são vetores densos que posicionam itens parecidos perto uns dos outros num espaço vetorial.',
      answer: 'Embeddings são vetores densos que posicionam palavras, frases ou imagens num espaço onde coisas parecidas ficam perto. Meus vetores TF-IDF são esparsos e só casam palavras iguais; embeddings capturam significado. Na seção Trajetória tem um mapa de embeddings das minhas habilidades.',
      action: { label: 'Ver o mapa de embeddings', href: '#embedding-root' }
    },
    {
      id: 'honesto', title: 'Sou uma IA de verdade?', q: 'Você é uma IA de verdade?',
      tags: 'raul ia verdade real llm chatgpt gpt generativo gerativo inteligente robo bot humano consciente pensa honesto alucina funciona',
      text: 'O RaulGPT não é um LLM e não gera texto: é só recuperação sobre trechos escritos à mão.',
      answer: 'Sendo honesto: não sou um LLM e não gero texto. Sou recuperação pura — TF-IDF + cosseno sobre {n} trechos escritos à mão. Se a pergunta não estiver na minha base, eu aviso em vez de inventar. Pelo menos não alucino.'
    },
    {
      id: 'piada', title: 'Piada de ML', q: 'Me conta uma piada de ML', small: true,
      tags: 'piada piadas humor ml',
      text: 'Piadas nerds para descontrair.',
      answer: [
        'Meu modelo acertou 100% no treino e 52% no teste. Ele não aprendeu: decorou a prova. Overfitting é basicamente isso.',
        'Um k-means entra num bar. O garçom pergunta: “Mesa para quantos?” E ele: “Depende… qual é o k?”',
        'Quantos cientistas de dados são necessários para trocar uma lâmpada? Depende: vocês têm dados rotulados?',
        'Por que a rede neural foi à terapia? Não conseguia parar de revisitar o passado — coisa de quem vive de retropropagação.'
      ]
    },
    {
      id: 'cafe', title: 'Café', q: 'Você gosta de café?', small: true,
      tags: 'cafe cafeina coffee bebida acuracia limitacao limitacoes energia combustivel',
      text: 'Segundo o model card, a acurácia cai sem café.',
      answer: 'Segundo o meu model card, a acurácia cai sem café ☕. É a única limitação documentada até agora — e ninguém abriu uma issue para corrigir.'
    },
    {
      id: 'easter', title: 'Easter eggs', q: 'Tem algum easter egg?',
      tags: 'easter egg eggs segredo segredos escondido secreto atalho atalhos teclado ctrl comandos konami truque surpresa',
      text: 'Ctrl+K abre a paleta de comandos; o código Konami esconde uma surpresa.',
      answer: 'Tem, sim. Aperte Ctrl + K para abrir a paleta de comandos e navegar pelo site só com o teclado. E, se você conhece o código Konami (↑ ↑ ↓ ↓ ← → ← → B A)… experimente. Digamos que o site pode sofrer um leve overfitting.',
      action: { label: 'Abrir a paleta de comandos', emit: 'palette:open' }
    },
    {
      id: 'saudacao', title: 'Saudação', q: 'Oi!', small: true,
      tags: 'oi ola opa eai salve hello hi hey bom dia boa tarde noite tudo bem beleza',
      text: 'Cumprimentos e boas-vindas.',
      answer: 'Oi! Tudo ótimo por aqui, com os vetores normalizados. Pergunte sobre a minha trajetória, o que estou estudando ou qualquer algoritmo deste site.'
    },
    {
      id: 'agradecimento', title: 'Agradecimento', q: 'Valeu!', small: true,
      tags: 'obrigado obrigada valeu brigado thanks agradeco legal show top massa incrivel parabens tchau logo',
      text: 'Agradecimentos e despedidas.',
      answer: 'Eu que agradeço! Se quiser continuar a conversa fora do navegador, me chama no [LinkedIn](' + LINKEDIN + ').'
    }
  ];

  /* =====================================================================
     2. NÚCLEO DE RECUPERAÇÃO (sem DOM)
     ===================================================================== */
  function toSet(str) {
    var o = Object.create(null);
    str.split(/\s+/).forEach(function (w) { if (w) o[w] = 1; });
    return o;
  }

  /* stopwords do português (já sem acento) + muletas de pergunta */
  var STOP = toSet(
    'a o e as os um uma uns umas de do da dos das d no na nos nas em num numa nuns numas por pelo pela pelos pelas ' +
    'para pra pro pras pros com sem sob sobre ate apos entre contra desde ao aos eu ele ela eles elas vos me te se lhe lhes ' +
    'mim ti si comigo contigo meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa dele dela deles delas ' +
    'isso isto esse essa esses essas este esta estes estas aquele aquela aqueles aquelas aquilo que q oq oque qual quais ' +
    'quanto quanta quantos quantas como quando porque pq porq ou mas nem tambem tb tbm so ja ainda muito muita muitos ' +
    'muitas mais menos pouco ser sou es eh era eram foi foram fui seja sao estar estou estao estava estive tem ter tenho ' +
    'tinha tive tinham havia ha houve vai vou ir fazer faz fiz fez faco fazia fizeram fazendo pode posso poderia podia ' +
    'sabe saber sei conhece conhecer conheco quero queria gostaria gosta gosto curte diz dizer conta conte contar fala fale ' +
    'explica explique ' +
    'explicar mostra mostre n nao sim ok aqui ali la ai entao assim tipo coisa coisas algo alguma algum alguns algumas ' +
    'cada outro outra outros outras mesmo mesma todo toda todos todas seria sido sendo tava to ta vez favor por'
  );
  /* palavras "fracas": dizem pouco sozinhas, mas ajudam quando é só o que sobra */
  var WEAK = {
    voce: 'raul', voces: 'raul', vc: 'raul', vcs: 'raul', ce: 'raul', tu: 'raul', raul: 'raul',
    quem: 'quem', onde: 'onde', funciona: 'funcion', funcionam: 'funcion'
  };
  /* sinônimos: palavra da pergunta → termo-cabeça adicionado com peso W_SYN.
     "=palavra" casa só a forma exata (ex.: "estudou" → formação, sem afetar "estuda") */
  var SYN_SRC = {
    contato: 'falar falo conversar chamar mensagem email telefone whatsapp zap contratar encontrar',
    formacao: 'faculdade graduacao universidade escola diploma colegio ensino curso =estudou =estudei =cursou =cursei',
    experiencia: 'trabalho trabalhou trabalhar emprego empresa carreira profissional cargo atuou estagio',
    estudo: 'aprender aprendendo treinamento treinando',
    site: 'pagina portfolio portifolio website',
    piada: 'humor engracado rir risada zoeira trocadilho joke',
    cafe: 'cafeina coffee',
    objetivo: 'meta sonho futuro plano pretende ambicao',
    neural: 'perceptron neuronio',
    stack: 'tecnologia linguagem ferramenta habilidade framework',
    projeto: 'repositorio codigo',
    oi: 'ola opa eai salve hello hey',
    obrigado: 'valeu brigado thanks agradeco'
  };

  /* minúsculas, sem acento (NFD), "k-means" → "kmeans", só [a-z0-9] */
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/([a-z])-(?=[a-z0-9])/g, '$1')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* stemming leve: plurais e sufixos comuns (radical com ≥ 3 letras) */
  var SUFFIXES = ['amentos', 'imentos', 'amento', 'imento', 'izacao', 'izador', 'izando', 'izado', 'izada', 'izar', 'izou',
    'acao', 'icao', 'ucao', 'mente', 'ador', 'edor', 'idor', 'ando', 'endo', 'indo', 'aram', 'eram', 'iram', 'avam',
    'ado', 'ido', 'ada', 'ida', 'ava', 'ou', 'ei', 'iu', 'eu', 'ar', 'er', 'ir', 'a', 'o', 'e'];
  function stem(w) {
    if (w.length <= 3 || /^[0-9]+$/.test(w)) return w;
    if (/[oa]es$/.test(w)) w = w.slice(0, -3) + 'ao';               // formações → formacao
    else if (/ais$/.test(w)) w = w.slice(0, -3) + 'al';             // neurais → neural
    else if (/eis$/.test(w) && w.length > 5) w = w.slice(0, -3) + 'el';
    else if (/gens$/.test(w)) w = w.slice(0, -2) + 'm';             // imagens → imagem
    else if (/[oui]ns$/.test(w)) w = w.slice(0, -2) + 'm';
    else if (/[rz]es$/.test(w) && w.length > 5) w = w.slice(0, -2); // valores → valor
    else if (/[^su]s$/.test(w)) w = w.slice(0, -1);
    for (var i = 0; i < SUFFIXES.length; i++) {
      var s = SUFFIXES[i];
      if (w.length - s.length >= 3 && w.slice(-s.length) === s) return w.slice(0, -s.length);
    }
    return w;
  }

  function docTerms(str) {
    var out = [];
    normalize(str).split(' ').forEach(function (w) {
      if (!w || STOP[w] || w.length < 2) return;
      out.push(WEAK[w] || stem(w));
    });
    return out;
  }

  /* distância de edição (Damerau, transposição adjacente) com corte em max */
  function editDistance(a, b, max) {
    var la = a.length, lb = b.length, i, j;
    if (Math.abs(la - lb) > max) return max + 1;
    var pp = null, p = [], c;
    for (j = 0; j <= lb; j++) p[j] = j;
    for (i = 1; i <= la; i++) {
      c = [i];
      var best = i;
      for (j = 1; j <= lb; j++) {
        var v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (pp && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
        c[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      pp = p; p = c;
    }
    return p[lb];
  }

  var perf = typeof performance !== 'undefined' && performance.now ? performance : Date;
  var index = null;

  function buildIndex() {
    if (index) return index;
    var t0 = perf.now();
    var vocab = Object.create(null), terms = [], df = [], bags = [];
    KB.forEach(function (c) {
      var bag = Object.create(null);
      // título e tags contam em dobro
      docTerms([c.title, c.title, c.tags, c.tags, c.text].join(' ')).forEach(function (t) { bag[t] = (bag[t] || 0) + 1; });
      Object.keys(bag).forEach(function (t) {
        if (!(t in vocab)) { vocab[t] = terms.length; terms.push(t); df.push(0); }
        df[vocab[t]]++;
      });
      bags.push(bag);
    });
    var N = KB.length, V = terms.length, idf = new Float32Array(V), j;
    for (j = 0; j < V; j++) idf[j] = Math.log((1 + N) / (1 + df[j])) + 1; // idf suavizado
    var vecs = bags.map(function (bag) {
      var v = new Float32Array(V), s = 0, keys = Object.keys(bag);
      keys.forEach(function (t) { var k = vocab[t], w = (1 + Math.log(bag[t])) * idf[k]; v[k] = w; s += w * w; });
      s = Math.sqrt(s) || 1;
      keys.forEach(function (t) { v[vocab[t]] /= s; });
      return v;
    });
    var synWord = Object.create(null), synStem = Object.create(null);
    Object.keys(SYN_SRC).forEach(function (head) {
      var h = stem(head);
      SYN_SRC[head].split(' ').forEach(function (w) {
        if (w[0] === '=') { synWord[w.slice(1)] = h; return; }
        synWord[w] = h;
        var s = stem(w);
        if (s !== h) synStem[s] = h;
      });
    });
    index = {
      vocab: vocab, terms: terms, df: df, idf: idf, vecs: vecs, synWord: synWord, synStem: synStem,
      N: N, V: V, idfMax: Math.log(1 + N) + 1, buildMs: perf.now() - t0
    };
    return index;
  }

  /* termo do vocabulário mais próximo (mesma inicial; distância 1, ou 2 se ≥ 7 letras) */
  function fuzzy(s) {
    if (s.length < 4) return null;
    var max = s.length >= 7 ? 2 : 1, best = null, bestD = max + 1;
    index.terms.forEach(function (t) {
      if (t[0] !== s[0] || t.length < 3) return;
      var d = editDistance(s, t, max);
      if (d < bestD) { bestD = d; best = t; }
    });
    return best ? { term: best, d: bestD } : null;
  }

  /* Analisa a consulta, monta o vetor TF-IDF e ranqueia todos os trechos por cosseno */
  function retrieve(query) {
    var ix = buildIndex();
    var t0 = perf.now();
    var norm = normalize(query);
    var tokens = [], bag = Object.create(null), order = [], expand = [];
    function add(t, mult, kind) {
      if (!bag[t]) { bag[t] = { tf: 0, mult: 0, kind: kind }; order.push(t); }
      bag[t].tf++;
      if (mult > bag[t].mult) { bag[t].mult = mult; bag[t].kind = kind; }
    }
    norm.split(' ').forEach(function (w) {
      if (!w) return;
      if (STOP[w] || w.length < 2) { tokens.push({ kind: 'stop', raw: w }); return; }
      if (WEAK[w]) { add(WEAK[w], W_WEAK, 'weak'); tokens.push({ kind: 'weak', raw: w, stem: WEAK[w] }); return; }
      var s = stem(w), h = ix.synWord[w] || ix.synStem[s];
      if (s in ix.vocab) {
        add(s, 1, 'term'); tokens.push({ kind: 'term', raw: w, stem: s });
        if (h && h !== s) expand.push({ h: h, from: w });
        return;
      }
      // fora do vocabulário, mas é sinônimo conhecido: entra só o termo-cabeça
      if (h && h in ix.vocab) { add(h, W_SYN_OOV, 'syn'); tokens.push({ kind: 'syn', raw: w, stem: h, w: W_SYN_OOV }); return; }
      var f = fuzzy(s);
      if (f) {
        add(f.term, W_FIX, 'fix'); tokens.push({ kind: 'fix', raw: w, stem: f.term, d: f.d });
        h = ix.synStem[f.term];
        if (h && h !== f.term) expand.push({ h: h, from: w });
        return;
      }
      add(s, 1, 'oov'); tokens.push({ kind: 'oov', raw: w, stem: s });
    });
    // sinônimos: acrescenta o termo-cabeça do grupo, se ainda não estiver na consulta
    expand.forEach(function (e) {
      if (!bag[e.h] && e.h in ix.vocab) { add(e.h, W_SYN, 'syn'); tokens.push({ kind: 'syn', stem: e.h, from: e.from, w: W_SYN }); }
    });

    // vetor da consulta (termos fora do vocabulário entram na norma: pesam contra)
    var q = [], qn = 0;
    order.forEach(function (t) {
      var b = bag[t], k = t in ix.vocab ? ix.vocab[t] : -1;
      var w = (1 + Math.log(b.tf)) * (k >= 0 ? ix.idf[k] : ix.idfMax) * b.mult;
      qn += w * w;
      if (k >= 0) q.push({ k: k, w: w, t: t });
    });
    qn = Math.sqrt(qn);
    var scores = ix.vecs.map(function (v, i) {
      var dot = 0;
      for (var n = 0; n < q.length; n++) dot += q[n].w * v[q[n].k];
      return { i: i, id: KB[i].id, score: qn ? dot / qn : 0 };
    });
    var ranked = scores.slice().sort(function (a, b) { return b.score - a.score; });
    var hits = ranked.slice(0, 3);
    var best = hits[0];
    var empty = !q.length && !order.length;
    var fallback = empty || best.score < THRESHOLD;
    var related = null;
    if (!fallback && hits[1] && hits[1].score >= THRESHOLD && hits[1].score >= best.score * RELATED_MIN &&
        !KB[best.i].small && !KB[hits[1].i].small) related = hits[1];
    return {
      query: String(query), norm: norm, tokens: tokens, q: q, qnorm: qn,
      nnz: q.length, oov: order.length - q.length, hits: hits, best: best, related: related,
      fallback: fallback, empty: empty, ms: perf.now() - t0, dim: ix.V, docs: ix.N
    };
  }

  RR.raulgpt = {
    kb: KB, threshold: THRESHOLD,
    normalize: normalize, stem: stem, retrieve: retrieve,
    index: function () { return buildIndex(); }
  };

  /* =====================================================================
     3. INTERFACE
     ===================================================================== */
  var root = document.getElementById('raulgpt-root');
  if (!root) return;
  var el = RR.el;

  var SUGGESTIONS = ['Quem é você?', 'O que você estuda?', 'Onde você já trabalhou?', 'Como este site foi feito?',
    'O que é RAG?', 'Me conta uma piada de ML', 'Como falo com você?'];
  var FALLBACK_SUGGESTIONS = ['O que você estuda?', 'O que foi o Nova Geração?', 'Como funciona o k-means?',
    'Você é uma IA de verdade?', 'Tem algum easter egg?', 'O que tem na galeria?', 'Onde você já trabalhou?'];
  var GREETING = 'Oi! Eu sou o RaulGPT, uma versão do Raul feita de vetores TF-IDF que roda inteira no seu navegador. ' +
    'Pergunte sobre a minha trajetória, o que estou estudando ou qualquer algoritmo deste site — e acompanhe no inspetor como eu encontro cada resposta.';
  var FALLBACK_TEXT = 'Ainda não tenho isso na minha base… Sou um RAG pequeno, com {n} trechos escritos à mão, e prefiro admitir a inventar. Talvez uma destas ajude:';
  var EMPTY_TEXT = 'Depois de tirar as stopwords, não sobrou nenhuma palavra-chave na sua pergunta. Tente com um termo mais específico — por exemplo:';

  var ICONS = {
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };
  function icon(name, cls) { return el('span', { class: 'rg-ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', html: ICONS[name] }); }

  function fmt3(n) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
  function fmtMs(ms) { return Number(ms).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ms'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------- avatar: recorte circular do retrato, desenhado em canvas ---------- */
  var avatarSrc = null, pendingAv = [];
  function avatar(size, cls) {
    var px = Math.ceil(size * RR.dpr(2));
    var c = el('canvas', { width: px, height: px });
    var a = el('span', { class: 'rg-av' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, [el('span', { class: 'rg-av__r', text: 'R' }), c]);
    if (avatarSrc) paintAvatar(a, c); else pendingAv.push([a, c]);
    return a;
  }
  function paintAvatar(a, c) {
    c.getContext('2d').drawImage(avatarSrc, 0, 0, c.width, c.height);
    a.classList.add('is-ready');
  }
  function loadAvatar() {
    RR.loadPortrait().then(function (img) {
      var S = 168, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      var x = cv.getContext('2d');
      var g = x.createRadialGradient(S * 0.5, S * 0.38, S * 0.08, S * 0.5, S * 0.5, S * 0.75);
      g.addColorStop(0, '#2c4290'); g.addColorStop(1, '#0c1330');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      // quadrado em torno do rosto, em coordenadas do arquivo original (491×712)
      var k = (img.naturalWidth || 491) / 491;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 96 * k, 140 * k, 330 * k, 330 * k, 0, 0, S, S);
      avatarSrc = cv;
      pendingAv.forEach(function (p) { if (p[0].isConnected) paintAvatar(p[0], p[1]); });
      pendingAv = [];
    }).catch(function () { pendingAv = []; });
  }

  /* ---------- montagem do DOM ---------- */
  var ui = {};
  ui.statusText = el('span', { class: 'rg__status-text', text: 'indexando' });
  ui.statusExtra = el('span', { class: 'rg__status-extra' });
  var bar = el('div', { class: 'rg__bar mono' }, [
    el('span', { class: 'rg__path' }, [
      el('span', { class: 'rg__logo', 'aria-hidden': 'true' }),
      el('span', { text: 'rag' }), el('span', { class: 'rg__sep', 'aria-hidden': 'true', text: '/' }),
      el('span', { class: 'rg__file', text: 'raulgpt.js' })
    ]),
    el('span', { class: 'rg__status' }, [el('span', { class: 'rg__dot', 'aria-hidden': 'true' }), ui.statusText, ui.statusExtra])
  ]);

  ui.clear = el('button', { class: 'btn btn--ghost btn--sm rg__clear', type: 'button', 'aria-label': 'Limpar conversa', onclick: clearChat },
    [icon('trash'), el('span', { class: 'rg__clear-label', text: 'Limpar' })]);
  var head = el('div', { class: 'rg__head' }, [
    el('div', { class: 'rg__persona' }, [
      el('span', { class: 'rg__ring' }, avatar(40, 'rg-av--lg')),
      el('div', { class: 'rg__who' }, [
        el('p', { class: 'rg__name' }, ['RaulGPT', el('span', { class: 'tag', text: 'mini-RAG' })]),
        el('p', { class: 'rg__sub mono' }, ['TF-IDF + cosseno', el('span', { class: 'rg__sub-x', text: ' · 100% no seu navegador' })])
      ])
    ]),
    ui.clear
  ]);

  ui.log = el('div', {
    class: 'rg__log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions',
    'aria-label': 'Conversa com o RaulGPT', tabindex: '0'
  });

  function chip(q, cls) {
    return el('button', { class: 'chip rg-chip' + (cls ? ' ' + cls : ''), type: 'button', onclick: function () { ask(q); } }, q);
  }
  ui.chips = el('div', { class: 'rg__chips', role: 'group', 'aria-label': 'Perguntas sugeridas' }, SUGGESTIONS.map(function (q) { return chip(q); }));

  ui.input = el('input', {
    id: 'raulgpt-input', class: 'rg__input', type: 'text', autocomplete: 'off', maxlength: '160',
    enterkeyhint: 'send', placeholder: 'Pergunte algo… ex.: o que é k-means?'
  });
  ui.send = el('button', { class: 'btn btn--primary rg__send', type: 'submit', 'aria-label': 'Enviar pergunta', disabled: true }, icon('send'));
  ui.form = el('form', { class: 'rg__form', novalidate: true, onsubmit: onSubmit }, [
    el('label', { class: 'sr-only', for: 'raulgpt-input', text: 'Sua pergunta para o RaulGPT' }),
    el('div', { class: 'rg__field' }, [el('span', { class: 'rg__prompt mono', 'aria-hidden': 'true', text: '›' }), ui.input]),
    ui.send
  ]);
  var hint = el('p', { class: 'rg__hint mono' }, [
    el('span', null, [el('kbd', { text: 'Enter' }), ' envia · ', el('kbd', { text: '↑' }), ' repete a anterior']),
    el('span', { class: 'rg__hint-r', text: 'respostas recuperadas, não geradas' })
  ]);
  var chat = el('div', { class: 'rg__chat' }, [head, el('div', { class: 'rg__logwrap' }, ui.log), ui.chips, ui.form, hint]);

  /* ---------- inspetor de recuperação ---------- */
  function sec(num, label, right) {
    var body = el('div', { class: 'rg-sec__body' });
    var node = el('div', { class: 'rg-sec' }, [
      el('p', { class: 'rg-sec__label mono' }, [
        el('span', { class: 'rg-sec__num', text: num }), el('span', { text: label }),
        el('span', { class: 'rg-sec__line', 'aria-hidden': 'true' }), right || null
      ]),
      body
    ]);
    return { node: node, body: body };
  }

  ui.qRaw = el('p', { class: 'rg-q__raw mono' });
  ui.qNorm = el('p', { class: 'rg-q__norm mono' });
  var s1 = sec('01', 'normalização');
  s1.body.appendChild(ui.qRaw); s1.body.appendChild(ui.qNorm);

  ui.toks = el('div', { class: 'rg-toks' });
  ui.legend = el('p', { class: 'rg-legend mono', 'aria-hidden': 'true' });
  var s2 = sec('02', 'tokens');
  s2.body.appendChild(ui.toks); s2.body.appendChild(ui.legend);

  ui.strip = el('canvas', { 'aria-hidden': 'true' });
  ui.stripWrap = el('div', { class: 'rg-vec__wrap' }, ui.strip);
  ui.vecCap = el('p', { class: 'rg-vec__cap mono' });
  var s3 = sec('03', 'vetor esparso');
  s3.body.appendChild(el('div', { class: 'rg-vec' }, [
    el('div', { class: 'rg-vec__lbls mono', 'aria-hidden': 'true' }, [el('span', { text: 'q' }), el('span', { text: 'd₁' })]),
    ui.stripWrap
  ]));
  s3.body.appendChild(ui.vecCap);

  ui.hits = el('ol', { class: 'rg-hits', 'aria-label': 'Trechos mais similares' });
  ui.hitRows = [0, 1, 2].map(function (k) {
    var r = {
      title: el('span', { class: 'rg-hit__t' }),
      id: el('span', { class: 'rg-hit__id mono' }),
      score: el('span', { class: 'rg-hit__score mono' }),
      fill: el('span', { class: 'rg-hit__fill' }),
      ctx: k === 0 ? el('p', { class: 'rg-hit__ctx mono' }) : null
    };
    r.node = el('li', { class: 'rg-hit is-empty', style: { '--k': k } }, [
      el('span', { class: 'rg-hit__rank mono', 'aria-hidden': 'true', text: String(k + 1) }),
      el('span', { class: 'rg-hit__title' }, [r.title, r.id]),
      r.score,
      el('span', { class: 'rg-hit__track', 'aria-hidden': 'true' }, [r.fill, el('span', { class: 'rg-hit__thr', style: { left: THRESHOLD * 100 + '%' } })]),
      r.ctx
    ]);
    ui.hits.appendChild(r.node);
    return r;
  });
  var s4 = sec('04', 'top-3 por cosseno', el('span', { class: 'rg-sec__thr', text: 'limiar ' + RR.fmt(THRESHOLD, 2) }));
  s4.body.appendChild(ui.hits);

  function metric(label) {
    var v = el('span', { class: 'rg-met__v mono', text: '—' });
    return { node: el('div', { class: 'rg-met' }, [el('span', { class: 'rg-met__l mono', text: label }), v]), v: v };
  }
  ui.mDim = metric('dimensões');
  ui.mDocs = metric('trechos');
  ui.mNnz = metric('termos');
  ui.mLat = metric('latência');
  var s5 = sec('05', 'métricas');
  s5.body.appendChild(el('div', { class: 'rg-mets' }, [ui.mDim.node, ui.mDocs.node, ui.mNnz.node, ui.mLat.node]));

  ui.sumMain = el('span', { text: 'aguardando' });
  ui.sumLat = el('span', { class: 'rg-sum__lat' });
  ui.sumStat = el('span', { class: 'rg-sum__stat mono' }, [ui.sumMain, ui.sumLat]);
  ui.insp = el('details', { class: 'rg__insp' }, [
    el('summary', { class: 'rg-sum' }, [
      el('span', { class: 'rg-sum__title' }, [el('span', { class: 'rg-sum__dot', 'aria-hidden': 'true' }), 'Inspetor de recuperação']),
      ui.sumStat, icon('chevron', 'rg-sum__chev')
    ]),
    el('div', { class: 'rg-insp' }, [
      el('div', { class: 'rg-insp__head' }, [
        el('h3', { class: 'rg-insp__title' }, [el('span', { class: 'rg-sum__dot', 'aria-hidden': 'true' }), 'Inspetor de recuperação']),
        el('span', { class: 'tag tag--blue', text: 'TF-IDF' })
      ]),
      s1.node, s2.node, s3.node, s4.node, s5.node,
      el('p', { class: 'rg-formula mono' }, [el('b', { text: 'cos(q, d)' }), ' = q · d / (‖q‖ ‖d‖)'])
    ])
  ]);

  ui.win = el('div', { class: 'rg', 'data-state': 'idle' }, [bar, el('div', { class: 'rg__body' }, [chat, ui.insp])]);
  root.appendChild(ui.win);

  /* desktop: inspetor sempre aberto, como coluna; celular: <details> recolhível */
  var mqDesk = window.matchMedia ? window.matchMedia('(min-width: 960px)') : null;
  function syncDesk() { if (mqDesk && mqDesk.matches) ui.insp.open = true; }
  var mqNarrow = window.matchMedia ? window.matchMedia('(max-width: 560px)') : null;
  function syncPlaceholder() {
    ui.input.placeholder = mqNarrow && mqNarrow.matches ? 'Pergunte algo…' : 'Pergunte algo… ex.: o que é k-means?';
  }
  syncPlaceholder();
  if (mqNarrow) {
    if (mqNarrow.addEventListener) mqNarrow.addEventListener('change', syncPlaceholder);
    else if (mqNarrow.addListener) mqNarrow.addListener(syncPlaceholder);
  }
  syncDesk();
  if (mqDesk) {
    if (mqDesk.addEventListener) mqDesk.addEventListener('change', syncDesk);
    else if (mqDesk.addListener) mqDesk.addListener(syncDesk);
  }
  ui.insp.addEventListener('toggle', function () { if (ui.insp.open) drawStrip(); });

  /* ---------- estado ---------- */
  var current = null;      // resposta em andamento: { finish() }
  var greeted = false;
  var lastRes = null;
  var stick = true;        // rolar o log junto com a resposta?
  var hist = [], hi = -1;  // histórico de perguntas (↑ / ↓)
  var rot = {};            // rodízio de respostas múltiplas

  function setState(state, text) {
    ui.win.setAttribute('data-state', state);
    ui.statusText.textContent = text;
  }
  function setReady() {
    var ix = buildIndex();
    setState('idle', 'pronto');
    ui.statusExtra.textContent = ' · ' + ix.N + ' trechos · ' + ix.V + ' dims';
    ui.mDim.v.textContent = String(ix.V);
    ui.mDocs.v.textContent = String(ix.N);
  }

  ui.log.addEventListener('scroll', function () {
    stick = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 56;
  }, { passive: true });
  function scrollLog(force) {
    if (force) stick = true;
    if (stick) ui.log.scrollTop = ui.log.scrollHeight;
  }

  /* ---------- texto das respostas: [rótulo](url) → link ---------- */
  function parse(text) {
    text = text.replace(/\{n\}/g, String(KB.length));
    var segs = [], re = /\[([^\]]+)\]\(([^)\s]+)\)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) segs.push({ s: text.slice(last, m.index) });
      segs.push({ s: m[1], href: m[2] });
      last = re.lastIndex;
    }
    if (last < text.length) segs.push({ s: text.slice(last) });
    return segs;
  }
  function segNode(seg) {
    if (seg.href && /^(https:\/\/|#)/.test(seg.href)) {
      var a = el('a', seg.href[0] === '#' ? { href: seg.href } : { href: seg.href, target: '_blank', rel: 'noopener noreferrer' });
      var t = document.createTextNode('');
      a.appendChild(t);
      return { node: a, text: t };
    }
    var tn = document.createTextNode('');
    return { node: tn, text: tn };
  }
  function renderSegments(segs) {
    var frag = document.createDocumentFragment();
    segs.forEach(function (s) { var n = segNode(s); n.text.data = s.s; frag.appendChild(n.node); });
    return frag;
  }

  /* "tokens" de exibição: espaço + palavra; palavras longas viram subtokens, como no BPE */
  var TOK_RE = /\s*[0-9A-Za-zÀ-ÖØ-öø-ÿ]+|\s*[^\s0-9A-Za-zÀ-ÖØ-öø-ÿ]|\s+/gu;
  function splitTokens(s) {
    var out = [], m;
    TOK_RE.lastIndex = 0;
    while ((m = TOK_RE.exec(s))) {
      var t = m[0];
      if (t.length > 8) { for (var k = 0; k < t.length; k += 5) out.push(t.slice(k, k + 5)); }
      else out.push(t);
    }
    return out;
  }

  /* Escreve os segmentos token a token (~18–28 ms/token, pausas na pontuação) */
  function streamSegments(target, segs, onProgress, onDone) {
    var toks = [], times = [], acc = 0;
    segs.forEach(function (s, si) { splitTokens(s.s).forEach(function (t) { toks.push([si, t]); }); });
    toks.forEach(function (tk, k) {
      times.push(acc);
      acc += 18 + Math.random() * 10;
      if (/[.!?…]\s*$/.test(tk[1])) acc += 110;
      else if (/[,;:—]\s*$/.test(tk[1])) acc += 40;
      if (k === 0) acc += 10;
    });
    var nodes = [], caret = el('span', { class: 'rg-caret' });
    target.appendChild(caret);
    var i = 0, t0 = 0, raf = 0, ended = false;
    function push() {
      var tk = toks[i++], n = nodes[tk[0]];
      if (!n) { n = nodes[tk[0]] = segNode(segs[tk[0]]); target.insertBefore(n.node, caret); }
      n.text.data += tk[1];
    }
    function frame(ts) {
      if (!t0) t0 = ts;
      var elapsed = ts - t0, moved = false;
      while (i < toks.length && times[i] <= elapsed) { push(); moved = true; }
      if (moved) onProgress();
      if (i >= toks.length) end(); else raf = requestAnimationFrame(frame);
    }
    function end() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      caret.remove();
      onDone();
    }
    if (RR.reducedMotion || !toks.length) end();
    else raf = requestAnimationFrame(frame);
    return { finish: end };
  }

  /* ---------- mensagens ---------- */
  function addUser(text) {
    ui.log.appendChild(el('div', { class: 'rg-msg rg-msg--user' },
      el('div', { class: 'rg-msg__main' }, el('div', { class: 'rg-bubble' }, [el('span', { class: 'sr-only', text: 'Você: ' }), text]))));
    scrollLog(true);
  }

  function actionNode(act) {
    var kids = [act.label, icon('arrow')];
    if (act.gallery) {
      return el('a', {
        class: 'rg-act', href: '#galeria',
        onclick: function (e) { e.preventDefault(); RR.emit('gallery:select', act.gallery); }
      }, kids);
    }
    if (act.href) {
      return el('a', { class: 'rg-act', href: act.href, onclick: function () { if (act.emit) RR.emit(act.emit); } }, kids);
    }
    return el('button', { class: 'rg-act', type: 'button', onclick: function () { RR.emit(act.emit); } }, kids);
  }

  function buildExtras(reply) {
    var box = el('div', { class: 'rg-msg__extras' });
    if (reply.action) box.appendChild(actionNode(reply.action));
    if (reply.related) {
      box.appendChild(el('span', { class: 'rg-rel' }, [el('span', { class: 'rg-rel__lbl mono', text: 'Relacionado:' }), chip(reply.related.q)]));
    }
    if (reply.suggest) reply.suggest.forEach(function (q) { box.appendChild(chip(q)); });
    return box.childNodes.length ? box : null;
  }

  /* Indicador de digitação → streaming → troca pela versão final (anunciada pelo aria-live) */
  function respond(reply, delay) {
    var typing = null, timer = 0, stream = null, job = {};
    function begin() {
      timer = 0;
      if (typing) typing.remove();
      var bubble = el('div', { class: 'rg-bubble' });
      var main = el('div', { class: 'rg-msg__main' }, bubble);
      ui.log.appendChild(el('div', { class: 'rg-msg rg-msg--bot' }, [avatar(30), main]));
      var live = el('div', { class: 'rg-bubble__text', 'aria-hidden': 'true' });
      bubble.appendChild(live);
      setState('busy', 'respondendo');
      scrollLog();
      stream = streamSegments(live, reply.segs, scrollLog, function () {
        var fin = el('div', { class: 'rg-bubble__text' }, el('span', { class: 'sr-only', text: 'RaulGPT: ' }));
        fin.appendChild(renderSegments(reply.segs));
        bubble.replaceChild(fin, live);
        if (reply.meta) main.appendChild(el('p', { class: 'rg-msg__meta mono', 'aria-hidden': 'true', text: reply.meta }));
        var ex = buildExtras(reply);
        if (ex) main.appendChild(ex);
        if (current === job) current = null;
        setReady();
        scrollLog();
      });
    }
    job.finish = function () {
      if (timer) { clearTimeout(timer); begin(); }
      if (stream) stream.finish();
    };
    current = job;
    if (delay > 0) {
      typing = el('div', { class: 'rg-msg rg-msg--bot rg-msg--typing', 'aria-hidden': 'true' }, [
        avatar(30),
        el('div', { class: 'rg-msg__main' }, el('div', { class: 'rg-bubble rg-typing' }, [
          el('span', { class: 'rg-typing__dots' }, [el('i'), el('i'), el('i')]),
          el('span', { class: 'rg-typing__txt mono', text: 'buscando em ' + buildIndex().N + ' trechos' })
        ]))
      ]);
      ui.log.appendChild(typing);
      setState('busy', 'buscando');
      scrollLog();
      timer = setTimeout(begin, delay);
    } else begin();
  }

  function finishCurrent() {
    if (!current) return;
    var c = current;
    current = null;
    c.finish();
  }

  function pickAnswer(c) {
    if (!Array.isArray(c.answer)) return c.answer;
    if (!(c.id in rot)) rot[c.id] = Math.floor(Math.random() * c.answer.length);
    return c.answer[rot[c.id]++ % c.answer.length];
  }

  function compose(res) {
    if (res.fallback) {
      var sug = [];
      res.hits.forEach(function (h) { if (h.score > 0.06 && !KB[h.i].small && sug.length < 2) sug.push(KB[h.i].q); });
      var pool = FALLBACK_SUGGESTIONS.slice().sort(function () { return Math.random() - 0.5; });
      for (var k = 0; k < pool.length && sug.length < 3; k++) if (sug.indexOf(pool[k]) < 0) sug.push(pool[k]);
      return {
        segs: parse(res.empty ? EMPTY_TEXT : FALLBACK_TEXT),
        meta: res.empty ? '↳ nenhum termo útil depois das stopwords' : '↳ melhor cos ' + fmt3(res.best.score) + ' < limiar ' + RR.fmt(THRESHOLD, 2),
        suggest: sug
      };
    }
    var c = KB[res.best.i];
    return {
      segs: parse(pickAnswer(c)),
      meta: '↳ fonte #' + pad2(res.best.i + 1) + ' · ' + c.title + ' · cos ' + fmt3(res.best.score),
      action: c.action || null,
      related: res.related ? KB[res.related.i] : null
    };
  }

  function ask(text) {
    var q = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!q) return;
    finishCurrent();
    if (!greeted && !ui.log.firstChild) sysLine();
    greeted = true;
    if (hist[hist.length - 1] !== q) hist.push(q);
    if (hist.length > 30) hist.shift();
    hi = -1;
    addUser(q);
    var res = retrieve(q);
    renderInspector(res);
    respond(compose(res), RR.reducedMotion ? 0 : 340 + Math.random() * 260);
  }

  function sysLine() {
    var ix = buildIndex();
    ui.log.appendChild(el('p', { class: 'rg-sys mono', 'aria-hidden': 'true' }, [
      el('span', null, ['índice TF-IDF pronto · ' + ix.N + ' trechos', el('span', { class: 'rg-sys__x', text: ' · ' + ix.V + ' termos · ' + fmtMs(ix.buildMs) })])
    ]));
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    if (!ui.log.firstChild) sysLine();
    respond({ segs: parse(GREETING) }, RR.reducedMotion ? 0 : 450);
  }

  function clearChat() {
    finishCurrent();
    ui.log.textContent = '';
    renderInspector(null);
    greeted = false;
    greet();
  }

  /* ---------- formulário ---------- */
  function syncSend() { ui.send.disabled = !ui.input.value.trim(); }
  function onSubmit(e) {
    e.preventDefault();
    var q = ui.input.value;
    if (!q.trim()) return;
    ui.input.value = '';
    syncSend();
    ask(q);
  }
  ui.input.addEventListener('input', function () { hi = -1; syncSend(); });
  ui.input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp' && hist.length && (hi >= 0 || !ui.input.value)) {
      e.preventDefault();
      hi = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1);
      ui.input.value = hist[hi];
      syncSend();
    } else if (e.key === 'ArrowDown' && hi >= 0) {
      e.preventDefault();
      hi++;
      ui.input.value = hi < hist.length ? hist[hi] : '';
      if (hi >= hist.length) hi = -1;
      syncSend();
    } else if (e.key === 'Escape' && ui.input.value) {
      ui.input.value = '';
      hi = -1;
      syncSend();
    }
  });

  /* ---------- inspetor: renderização ---------- */
  var KIND_LABEL = { term: 'termo', stop: 'stopword', weak: 'peso fraco', fix: 'corrigido', syn: 'sinônimo', oov: 'fora do vocabulário' };

  function tokenChip(t, k) {
    var node = el('span', { class: 'rg-tok rg-tok--' + t.kind, style: { '--i': k } });
    if (t.kind === 'term') {
      if (t.raw.indexOf(t.stem) === 0 && t.raw !== t.stem) {
        node.appendChild(document.createTextNode(t.stem));
        node.appendChild(el('span', { class: 'rg-tok__cut', text: t.raw.slice(t.stem.length) }));
      } else node.appendChild(document.createTextNode(t.stem));
      node.title = 'radical de “' + t.raw + '”';
    } else if (t.kind === 'stop') {
      node.appendChild(document.createTextNode(t.raw));
      node.title = 'stopword: removida';
    } else if (t.kind === 'weak') {
      node.appendChild(document.createTextNode(t.raw === t.stem ? t.stem : t.raw + '→' + t.stem));
      node.appendChild(el('small', { text: '×' + RR.fmt(W_WEAK, 2) }));
      node.title = 'palavra fraca: peso reduzido';
    } else if (t.kind === 'fix') {
      node.appendChild(document.createTextNode(t.raw + '→' + t.stem));
      node.title = 'correção de digitação (distância ' + t.d + ')';
    } else if (t.kind === 'syn') {
      node.appendChild(document.createTextNode(t.raw ? t.raw + '→' + t.stem : '+' + t.stem));
      node.appendChild(el('small', { text: '×' + RR.fmt(t.w, 2) }));
      node.title = 'sinônimo de “' + (t.raw || t.from) + '”';
    } else {
      node.appendChild(document.createTextNode(t.stem));
      node.title = 'fora do vocabulário: não casa com nenhum trecho';
    }
    if (t.kind !== 'term') node.appendChild(el('span', { class: 'sr-only', text: ' (' + KIND_LABEL[t.kind] + ')' }));
    return node;
  }

  function renderInspector(res) {
    lastRes = res;
    ui.toks.textContent = '';
    ui.legend.textContent = '';
    if (!res) {
      ui.qRaw.textContent = 'aguardando pergunta';
      ui.qRaw.classList.add('is-idle');
      ui.qNorm.textContent = '';
      ui.toks.appendChild(el('span', { class: 'rg-toks__idle mono', text: 'os tokens aparecem aqui' }));
      ui.vecCap.textContent = 'cada traço é uma dimensão não nula';
      ui.hitRows.forEach(function (r) {
        r.node.className = 'rg-hit is-empty';
        r.title.textContent = '—';
        r.id.textContent = '';
        r.score.textContent = '0,000';
        r.fill.style.width = '0%';
        if (r.ctx) r.ctx.textContent = '';
      });
      ui.mNnz.v.textContent = '—';
      ui.mLat.v.textContent = '—';
      ui.sumMain.textContent = 'aguardando';
      ui.sumLat.textContent = '';
      drawStrip();
      return;
    }
    ui.qRaw.classList.remove('is-idle');
    ui.qRaw.textContent = '“' + truncate(res.query, 90) + '”';
    ui.qNorm.textContent = '→ ' + (res.norm ? truncate(res.norm, 90) : '∅');

    var kinds = {};
    res.tokens.forEach(function (t, k) { kinds[t.kind] = 1; ui.toks.appendChild(tokenChip(t, k)); });
    if (!res.tokens.length) ui.toks.appendChild(el('span', { class: 'rg-toks__idle mono', text: 'nenhum token' }));
    ['term', 'stop', 'weak', 'fix', 'syn', 'oov'].forEach(function (k) {
      if (kinds[k]) ui.legend.appendChild(el('span', { class: 'rg-legend__' + k, text: KIND_LABEL[k] }));
    });

    var ix = buildIndex(), d1 = res.best.score > 0 ? ix.vecs[res.best.i] : null, dn = 0, common = 0;
    if (d1) for (var j = 0; j < ix.V; j++) if (d1[j] > 0) dn++;
    res.q.forEach(function (t) { if (d1 && d1[t.k] > 0) common++; });
    ui.vecCap.textContent = 'q: ' + res.nnz + ' de ' + ix.V + ' dims · d₁: ' + (d1 ? dn : '—') + ' · em comum: ' + common +
      (res.oov ? ' · ' + res.oov + ' fora do vocab.' : '');

    res.hits.forEach(function (h, k) {
      var r = ui.hitRows[k], c = KB[h.i];
      if (h.score <= 0) {
        r.node.className = 'rg-hit is-empty';
        r.title.textContent = 'sem correspondência';
        r.id.textContent = '';
        r.score.textContent = fmt3(0);
        r.fill.style.width = '0%';
        if (r.ctx) r.ctx.textContent = 'nenhum termo da consulta aparece na base';
        return;
      }
      r.node.className = 'rg-hit' + (k === 0 && !res.fallback ? ' is-top' : '') + (h.score < THRESHOLD ? ' is-below' : '');
      r.title.textContent = c.title;
      r.id.textContent = '#' + pad2(h.i + 1);
      r.score.textContent = fmt3(h.score);
      r.fill.style.width = RR.clamp(h.score, 0, 1) * 100 + '%';
      if (r.ctx) r.ctx.textContent = res.fallback ? 'abaixo do limiar: nenhum trecho usado' : c.text;
    });
    ui.mNnz.v.textContent = String(res.nnz);
    ui.mLat.v.textContent = fmtMs(res.ms);
    ui.sumMain.textContent = res.fallback ? '< limiar' : 'cos ' + fmt3(res.best.score);
    ui.sumLat.textContent = ' · ' + fmtMs(res.ms);
    drawStrip();
  }

  /* vetor esparso: linha de cima = consulta, de baixo = trecho nº 1; colunas em comum brilham.
     As dimensões são embaralhadas (permutação fixa) só para a exibição ficar espalhada. */
  var stripW = 0, perm = null;
  function dimPos(j) {
    if (!perm) {
      var V = index.V, rand = RR.rng(7), k, t;
      perm = new Uint16Array(V);
      for (k = 0; k < V; k++) perm[k] = k;
      for (k = V - 1; k > 0; k--) { var r = Math.floor(rand() * (k + 1)); t = perm[k]; perm[k] = perm[r]; perm[r] = t; }
    }
    return perm[j];
  }
  function drawStrip() {
    var w = Math.floor(ui.stripWrap.clientWidth);
    if (w < 40) return;
    stripW = w;
    var h = 40, ctx = RR.setupCanvas(ui.strip, w, h, 2);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fillRect(0, 2, w, 15);
    ctx.fillRect(0, 23, w, 15);
    if (!index) return;
    var V = index.V, cw = Math.max(2, w / V);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (var g = 0; g < V; g += 64) ctx.fillRect(Math.round(g / V * w), 2, 1, 36);
    var res = lastRes;
    if (!res || !(res.best.score > 0)) return;
    var d = index.vecs[res.hits[0].i], dmax = 0, qmax = 0, j, x;
    for (j = 0; j < V; j++) if (d[j] > dmax) dmax = d[j];
    res.q.forEach(function (t) { if (t.w > qmax) qmax = t.w; });
    var pal = RR.palette();
    for (j = 0; j < V; j++) {
      if (d[j] <= 0) continue;
      var hh = 4 + 11 * d[j] / dmax;
      x = dimPos(j) / V * (w - cw);
      ctx.fillStyle = res.fallback ? 'rgba(255,179,138,0.55)' : 'rgba(110,145,255,0.75)';
      ctx.fillRect(x, 38 - hh, cw, hh);
    }
    res.q.forEach(function (t) {
      var on = d[t.k] > 0, hq = 4 + 11 * t.w / qmax;
      x = dimPos(t.k) / V * (w - cw);
      if (on) {
        ctx.fillStyle = 'rgba(158,245,207,0.35)';
        ctx.fillRect(x + cw / 2 - 0.5, 17, 1, 6);
      }
      ctx.fillStyle = on ? pal.mint : 'rgba(158,245,207,0.5)';
      ctx.fillRect(x, 17 - hq, cw, hq);
    });
  }
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(function () {
      if (Math.floor(ui.stripWrap.clientWidth) !== stripW) requestAnimationFrame(drawStrip);
    });
    ro.observe(ui.stripWrap);
  } else window.addEventListener('resize', RR.debounce(drawStrip, 150));

  /* ---------- início ---------- */
  renderInspector(null);
  // animações CSS (cursor, pontos, anel) pausadas fora da tela
  RR.whenVisible(root, function () { root.classList.remove('is-paused'); }, function () { root.classList.add('is-paused'); });
  RR.onFirstVisible(root, function () {
    setReady();
    drawStrip();
    loadAvatar();
    greet();
  }, { rootMargin: '0px', threshold: 0.15 });

  /* API para outros módulos (ex.: paleta de comandos): RR.raulgpt.ask('O que é RAG?', {scroll: true}) */
  RR.raulgpt.ask = function (q, opts) {
    if (opts && opts.scroll) root.scrollIntoView({ behavior: RR.reducedMotion ? 'auto' : 'smooth', block: 'center' });
    ask(q);
  };
  RR.on('raulgpt:ask', function (q) { RR.raulgpt.ask(q, { scroll: true }); });
})();
